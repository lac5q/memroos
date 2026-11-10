import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import ConnectedToolsPage from "../page";
import { makeConnection, stubToolsFetch, wrap } from "./test-helpers";

describe("ConnectedToolsPage connection states", () => {
  beforeEach(() => {
    stubToolsFetch();
  });

  it("renders grouped provider categories from the registry", async () => {
    wrap(<ConnectedToolsPage />);
    await waitFor(() => {
      expect(screen.getByText(/Productivity/i)).toBeInTheDocument();
      expect(screen.getByText(/Developer/i)).toBeInTheDocument();
      expect(screen.getByText("Slack")).toBeInTheDocument();
      expect(screen.getByText("GitHub")).toBeInTheDocument();
    });
  });

  it("filters providers by label, description, and key", async () => {
    wrap(<ConnectedToolsPage />);
    await waitFor(() => expect(screen.getByText("GitHub")).toBeInTheDocument());

    const input = screen.getByPlaceholderText(/Search providers/i);
    fireEvent.change(input, { target: { value: "calendar" } });
    await waitFor(() => {
      expect(screen.getByText("Google Calendar")).toBeInTheDocument();
      expect(screen.queryByText("GitHub")).not.toBeInTheDocument();
    });

    fireEvent.change(input, { target: { value: "github" } });
    await waitFor(() => {
      expect(screen.getByText("GitHub")).toBeInTheDocument();
      expect(screen.queryByText("Slack")).not.toBeInTheDocument();
    });

    fireEvent.change(input, { target: { value: "Issues, PRs" } });
    await waitFor(() => {
      expect(screen.getByText("GitHub")).toBeInTheDocument();
    });
  });

  it("shows loading skeleton while providers load", async () => {
    stubToolsFetch({ delayProvidersMs: 80 });
    wrap(<ConnectedToolsPage />);
    expect(screen.getByLabelText(/Loading providers/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("GitHub")).toBeInTheDocument());
    expect(screen.queryByLabelText(/Loading providers/i)).not.toBeInTheDocument();
  });

  it("shows connected badge, account email, and revoke for active connections", async () => {
    stubToolsFetch({
      connections: {
        connections: [
          makeConnection({
            providerKey: "github",
            accountEmail: "dev@test.local",
          }),
        ],
      },
    });
    wrap(<ConnectedToolsPage />);
    await waitFor(() => {
      expect(screen.getByText("Connected")).toBeInTheDocument();
      expect(screen.getByText("dev@test.local")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Revoke/i })).toBeInTheDocument();
    });
    expect(screen.queryByText(/No tools connected yet/i)).not.toBeInTheDocument();
  });

  it("shows expired reconnect CTA and error badge states", async () => {
    stubToolsFetch({
      connections: {
        connections: [
          makeConnection({ providerKey: "github", status: "expired" }),
          makeConnection({ providerKey: "slack", status: "error", accountEmail: null }),
        ],
      },
    });
    wrap(<ConnectedToolsPage />);
    await waitFor(() => {
      expect(screen.getByText("Expired")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Reconnect/i })).toBeInTheDocument();
      expect(screen.getByText("Error")).toBeInTheDocument();
    });
  });
});

describe("ConnectedToolsPage usage and activity", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-10-16T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders unlimited usage without upgrade CTA", async () => {
    stubToolsFetch({
      usage: {
        usage: { used: 2, limit: Number.POSITIVE_INFINITY, plan: "enterprise" },
        approachingLimit: true,
      },
    });
    wrap(<ConnectedToolsPage />);
    await waitFor(() => {
      expect(screen.getByText(/Unlimited connections/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Upgrade Nango plan/i })).not.toBeInTheDocument();
    });
  });

  it("describes recent activity types and relative timestamps", async () => {
    stubToolsFetch({
      activity: {
        events: [
          {
            id: "e1",
            providerKey: "github",
            type: "connection_established",
            connectionId: "c1",
            at: "2026-10-16T11:59:30.000Z",
          },
          {
            id: "e2",
            providerKey: "slack",
            type: "connection_revoked",
            connectionId: "c2",
            at: "2026-10-16T11:30:00.000Z",
          },
          {
            id: "e3",
            providerKey: "notion",
            type: "token_refresh_failed",
            connectionId: "c3",
            at: "2026-10-16T10:00:00.000Z",
          },
          {
            id: "e4",
            providerKey: "linear",
            type: "test_failed",
            connectionId: "c4",
            message: "scope missing",
            at: "2026-10-14T08:00:00.000Z",
          },
          {
            id: "e6",
            providerKey: "google-drive",
            type: "test_failed",
            connectionId: "c6",
            at: "2026-10-16T11:45:00.000Z",
          },
          {
            id: "e5",
            providerKey: "unknown-provider",
            type: "test_succeeded",
            connectionId: "c5",
            at: "2026-10-16T11:59:50.000Z",
          },
        ],
      },
    });
    wrap(<ConnectedToolsPage />);
    await waitFor(() => {
      expect(screen.getByText("connected")).toBeInTheDocument();
      expect(screen.getByText("revoked")).toBeInTheDocument();
      expect(screen.getByText("token refresh failed")).toBeInTheDocument();
      expect(screen.getByText("scope missing")).toBeInTheDocument();
      expect(screen.getByText("test failed")).toBeInTheDocument();
      expect(screen.getByText("15 min ago")).toBeInTheDocument();
      expect(screen.getByText("unknown-provider")).toBeInTheDocument();
      expect(screen.getAllByText("just now").length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText("30 min ago")).toBeInTheDocument();
      expect(screen.getByText("2 hr ago")).toBeInTheDocument();
    });
  });

  it("opens Nango pricing when approaching the connection limit", async () => {
    const openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);
    stubToolsFetch({
      usage: {
        usage: { used: 4, limit: 5, plan: "starter" },
        approachingLimit: true,
      },
    });
    wrap(<ConnectedToolsPage />);
    await waitFor(() => screen.getByRole("button", { name: /Upgrade Nango plan/i }));
    fireEvent.click(screen.getByRole("button", { name: /Upgrade Nango plan/i }));
    expect(openSpy).toHaveBeenCalledWith("https://nango.dev/pricing", "_blank");
  });
});
