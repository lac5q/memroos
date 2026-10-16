import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import ConnectedToolsPage from "../page";
import { makeConnection, providerCard, stubToolsFetch, wrap } from "./test-helpers";

describe("ConnectedToolsPage OAuth connect", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses default popup dimensions when the API omits them", async () => {
    const openSpy = vi.fn(() => ({ closed: true }) as Window);
    vi.stubGlobal("open", openSpy);
    stubToolsFetch({
      oauthConnect: async () =>
        ({
          ok: true,
          json: async () => ({ authorizeUrl: "https://auth.test.local/default-size" }),
        }) as Response,
    });
    wrap(<ConnectedToolsPage />);
    await waitFor(() => expect(screen.getByText("GitHub")).toBeInTheDocument());
    fireEvent.click(within(providerCard(screen, "GitHub")).getByRole("button", { name: /Connect/i }));
    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        "https://auth.test.local/default-size",
        "nango-connect-github",
        "width=600,height=700",
      );
    });
  });

  it("opens OAuth popup and refreshes data when the popup closes", async () => {
    const invalidateSpy = vi.fn();
    const popup = { closed: false };
    const openSpy = vi.fn(() => popup as Window);
    vi.stubGlobal("open", openSpy);

    stubToolsFetch({
      oauthConnect: async (body) => {
        expect(JSON.parse(body)).toEqual({ providerKey: "github" });
        return {
          ok: true,
          json: async () => ({
            authorizeUrl: "https://auth.test.local/github",
            popupWidth: 500,
            popupHeight: 600,
          }),
        } as Response;
      },
    });

    const { qc } = wrap(<ConnectedToolsPage />);
    vi.spyOn(qc, "invalidateQueries").mockImplementation(invalidateSpy);

    await waitFor(() => expect(screen.getByText("GitHub")).toBeInTheDocument());
    fireEvent.click(within(providerCard(screen, "GitHub")).getByRole("button", { name: /Connect/i }));

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        "https://auth.test.local/github",
        "nango-connect-github",
        "width=500,height=600",
      );
    });

    popup.closed = true;
    await vi.advanceTimersByTimeAsync(600);

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["tools", "connections"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["tools", "activity"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["tools", "usage"] });
    });
  });

  it("falls back to error field when OAuth message is absent", async () => {
    stubToolsFetch({
      oauthConnect: async () =>
        ({
          ok: false,
          status: 400,
          json: async () => ({ error: "invalid_provider" }),
        }) as Response,
    });
    wrap(<ConnectedToolsPage />);
    await waitFor(() => expect(screen.getByText("GitHub")).toBeInTheDocument());
    fireEvent.click(within(providerCard(screen, "GitHub")).getByRole("button", { name: /Connect/i }));
    await waitFor(() => {
      expect(screen.getByText("invalid_provider")).toBeInTheDocument();
    });
  });

  it("surfaces OAuth API errors inline", async () => {
    stubToolsFetch({
      oauthConnect: async () =>
        ({
          ok: false,
          status: 503,
          json: async () => ({ message: "Nango unavailable at test.local" }),
        }) as Response,
    });
    wrap(<ConnectedToolsPage />);
    await waitFor(() => expect(screen.getByText("GitHub")).toBeInTheDocument());
    fireEvent.click(within(providerCard(screen, "GitHub")).getByRole("button", { name: /Connect/i }));
    await waitFor(() => {
      expect(screen.getByText("Nango unavailable at test.local")).toBeInTheDocument();
    });
  });

  it("surfaces network failures during OAuth connect", async () => {
    stubToolsFetch({
      oauthConnect: async () => {
        throw new Error("network down");
      },
    });
    wrap(<ConnectedToolsPage />);
    await waitFor(() => expect(screen.getByText("GitHub")).toBeInTheDocument());
    fireEvent.click(within(providerCard(screen, "GitHub")).getByRole("button", { name: /Connect/i }));
    await waitFor(() => {
      expect(screen.getByText("network down")).toBeInTheDocument();
    });
  });
});

describe("ConnectedToolsPage revoke flow", () => {
  it("closes the revoke confirmation sheet on cancel", async () => {
    stubToolsFetch({
      connections: {
        connections: [makeConnection({ providerKey: "github" })],
      },
    });
    wrap(<ConnectedToolsPage />);
    await waitFor(() => expect(screen.getByText("Connected")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^Revoke$/i }));
    await waitFor(() =>
      expect(screen.getByText(/Revoke GitHub connection/i)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));
    await waitFor(() =>
      expect(screen.queryByText(/Revoke GitHub connection/i)).not.toBeInTheDocument(),
    );
  });

  it("optimistically removes a connection and confirms disconnect", async () => {
    let disconnectBody: string | undefined;
    stubToolsFetch({
      connections: {
        connections: [makeConnection({ providerKey: "github", accountEmail: "ops@test.local" })],
      },
      disconnect: async (body) => {
        disconnectBody = body;
        await new Promise((r) => setTimeout(r, 50));
        return { ok: true, json: async () => ({}) } as Response;
      },
    });

    wrap(<ConnectedToolsPage />);
    await waitFor(() => expect(screen.getByText("Connected")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^Revoke$/i }));
    await waitFor(() =>
      expect(screen.getByText(/Revoke GitHub connection/i)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /Revoke connection/i }));
    await waitFor(() => {
      expect(screen.queryByText("Connected")).not.toBeInTheDocument();
      expect(JSON.parse(disconnectBody!)).toEqual({ providerKey: "github" });
    });
  });

  it("rolls back optimistic revoke when disconnect fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onUnhandled = () => undefined;
    process.on("unhandledRejection", onUnhandled);

    stubToolsFetch({
      connections: {
        connections: [makeConnection({ providerKey: "github" })],
      },
      disconnect: async () =>
        ({
          ok: false,
          status: 500,
          json: async () => ({}),
        }) as Response,
    });

    wrap(<ConnectedToolsPage />);
    await waitFor(() => expect(screen.getByText("Connected")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^Revoke$/i }));
    await waitFor(() =>
      expect(screen.getByText(/Revoke GitHub connection/i)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Revoke connection/i }));

    await waitFor(() => {
      expect(screen.getByText("Connected")).toBeInTheDocument();
      expect(errorSpy).toHaveBeenCalled();
    });
    errorSpy.mockRestore();
    process.off("unhandledRejection", onUnhandled);
  });
});
