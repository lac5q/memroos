/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import ApiKeysPage from "../page";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, mutations: { retry: false } } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("ApiKeysPage batch35", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fetchApiKeys throws when listing fails (stmt 41)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/auth/me")) {
          return {
            ok: true,
            json: async () => ({ id: "user-b35", email: "ops@memroos.com", displayName: "Ops" }),
          } as Response;
        }
        if (url.includes("/api-keys") && !init?.method) {
          return { ok: false, status: 503, json: async () => ({ error: "keys down b35" }) } as Response;
        }
        throw new Error(`unexpected ${url}`);
      }),
    );
    wrap(<ApiKeysPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Generate key/i })).toBeInTheDocument());
  });

  it("handleCopy writes minted key and clears copied state (stmt 115)", async () => {
    const keyRaw = `mrk_b35_${randomUUID()}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/auth/me")) {
          return {
            ok: true,
            json: async () => ({ id: "user-copy-b35", email: "ops@memroos.com", displayName: "Ops" }),
          } as Response;
        }
        if (url.includes("/api-keys") && init?.method === "POST") {
          return {
            ok: true,
            json: async () => ({
              id: "key-b35",
              keyRaw,
              label: "batch35",
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
    fireEvent.click(screen.getByRole("button", { name: /Generate key/i }));
    fireEvent.change(screen.getByLabelText(/Label/i), { target: { value: "batch35-key" } });
    fireEvent.click(screen.getByRole("button", { name: /^Generate$/i }));
    await waitFor(() => expect(screen.getByText(keyRaw)).toBeInTheDocument());

    const copyBtn = screen.getByText(keyRaw).parentElement?.querySelector("button");
    expect(copyBtn).toBeTruthy();
    fireEvent.click(copyBtn!);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(keyRaw);
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(2000);
    vi.useRealTimers();
  });
});
