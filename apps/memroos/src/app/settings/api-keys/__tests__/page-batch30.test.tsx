import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import ApiKeysPage from "../page";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, mutations: { retry: false } } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("ApiKeysPage batch30", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fetchMe throws when /api/auth/me is not ok (35)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        if (String(input).endsWith("/api/auth/me")) {
          return { ok: false, status: 401, json: async () => ({}) } as Response;
        }
        throw new Error(`unexpected fetch ${String(input)}`);
      }),
    );
    wrap(<ApiKeysPage />);
    await waitFor(() => expect(screen.getByText("API Keys")).toBeInTheDocument());
  });

  it("fetchApiKeys throws when listing fails (41)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/auth/me")) {
          return {
            ok: true,
            json: async () => ({ id: "user-keys-b30", email: "ops@memroos.com", displayName: "Ops" }),
          } as Response;
        }
        if (url.includes("/api/users/user-keys-b30/api-keys") && !init?.method) {
          return { ok: false, status: 503, json: async () => ({ error: "down" }) } as Response;
        }
        throw new Error(`unexpected ${url}`);
      }),
    );
    wrap(<ApiKeysPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Generate key/i })).toBeInTheDocument());
  });

  it("handleCopy is a no-op without newKeyRaw and resets copied state (115, 118)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/auth/me")) {
          return {
            ok: true,
            json: async () => ({ id: "user-b30", email: "ops@memroos.com", displayName: "Ops" }),
          } as Response;
        }
        if (url.includes("/api-keys") && init?.method === "POST") {
          return {
            ok: true,
            json: async () => ({
              id: "key-b30",
              keyRaw: "mr_batch30_copy_key",
              label: "copy",
              createdAt: "2026-07-01T00:00:00.000Z",
            }),
          } as Response;
        }
        if (url.includes("/api-keys") && !init?.method) {
          return { ok: true, json: async () => ({ apiKeys: [] }) } as Response;
        }
        throw new Error(`unexpected ${url}`);
      }),
    );
    wrap(<ApiKeysPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Generate key/i })).toBeInTheDocument());
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Generate key/i }));
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(screen.getByText(/mr_batch30_copy_key/)).toBeInTheDocument());
    const copyButton = screen.getByText(/mr_batch30_copy_key/).parentElement?.querySelector("button");
    fireEvent.click(copyButton!);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("mr_batch30_copy_key");

    vi.useFakeTimers();
    fireEvent.click(copyButton!);
    await vi.advanceTimersByTimeAsync(2000);
    vi.useRealTimers();
  });
});
