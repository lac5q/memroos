import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, mutations: { retry: false } } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

import ApiKeysPage from "../page";

describe("ApiKeysPage", () => {
  let keys: Array<{ id: string; label: string; createdAt: string; lastUsedAt: string | null }>;

  beforeEach(() => {
    keys = [
      {
        id: "key-1",
        label: "CI token",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastUsedAt: "2026-06-01T00:00:00.000Z",
      },
    ];
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/auth/me")) {
          return {
            ok: true,
            json: async () => ({ id: "user-1", email: "ops@memroos.com", displayName: "Ops" }),
          } as Response;
        }
        if (url.includes("/api/users/user-1/api-keys") && (!init || init.method === undefined)) {
          return { ok: true, json: async () => ({ apiKeys: keys }) } as Response;
        }
        if (url.includes("/api/users/user-1/api-keys") && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as { label?: string };
          if (body.label === "fail") {
            return { ok: false, json: async () => ({ error: "Quota exceeded" }) } as Response;
          }
          return {
            ok: true,
            json: async () => ({
              id: "key-new",
              keyRaw: "mr_test_key_raw_value.test.local",
              label: body.label ?? "",
              createdAt: "2026-07-01T00:00:00.000Z",
            }),
          } as Response;
        }
        if (url.includes("/api/users/user-1/api-keys/key-1") && init?.method === "DELETE") {
          keys = [];
          return { ok: true, status: 204 } as Response;
        }
        throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
      }),
    );
  });

  it("renders API keys header and listed keys", async () => {
    wrap(<ApiKeysPage />);

    expect(screen.getByText("API Keys")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("CI token")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Generate key/i })).toBeInTheDocument();
  });

  it("generates a key in the modal and supports copy + revoke", async () => {
    wrap(<ApiKeysPage />);
    await waitFor(() => expect(screen.getByText("CI token")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Generate key/i }));
    fireEvent.change(screen.getByLabelText("Label (optional)"), { target: { value: "Deploy bot" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(screen.getByText("API key generated")).toBeInTheDocument();
      expect(screen.getByText(/mr_test_key_raw_value/)).toBeInTheDocument();
    });

    const copyButton = screen.getByText(/mr_test_key_raw_value/).parentElement?.querySelector("button");
    expect(copyButton).toBeTruthy();
    fireEvent.click(copyButton!);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("mr_test_key_raw_value.test.local");

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(screen.getByText(/No API keys yet/i)).toBeInTheDocument();
    });
  });

  it("shows generation errors and can cancel the modal", async () => {
    wrap(<ApiKeysPage />);
    await waitFor(() => expect(screen.getByText("CI token")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Generate key/i }));
    fireEvent.change(screen.getByLabelText("Label (optional)"), { target: { value: "fail" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(screen.getByText("Quota exceeded")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("New API key")).not.toBeInTheDocument();
  });
});
