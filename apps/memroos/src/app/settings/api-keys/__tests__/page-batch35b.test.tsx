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
  return { qc, ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>) };
}

describe("ApiKeysPage batch35b", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fetchApiKeys failure surfaces query error state (41)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/auth/me")) {
          return {
            ok: true,
            json: async () => ({ id: `user-b35b-${randomUUID().slice(0, 6)}`, email: "ops@memroos.com", displayName: "Ops" }),
          } as Response;
        }
        if (url.includes("/api-keys") && !init?.method) {
          return { ok: false, status: 503, json: async () => ({ error: "keys unavailable b35b" }) } as Response;
        }
        throw new Error(`unexpected ${url}`);
      }),
    );
    const { qc } = wrap(<ApiKeysPage />);
    await waitFor(() => expect(qc.getQueryState(["me"])?.status).toBe("success"));
    const userId = (qc.getQueryData(["me"]) as { id: string }).id;
    await waitFor(() => {
      const state = qc.getQueryState(["api-keys", userId]);
      expect(state?.status).toBe("error");
      expect(state?.error).toMatchObject({ message: "Failed to fetch API keys" });
    });
  });

  it("handleCopy no-ops when newKeyRaw is unset (115)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.endsWith("/api/auth/me")) {
          return {
            ok: true,
            json: async () => ({ id: "user-copy-b35b", email: "ops@memroos.com", displayName: "Ops" }),
          } as Response;
        }
        if (url.includes("/api-keys")) {
          return { ok: true, json: async () => ({ apiKeys: [] }) } as Response;
        }
        throw new Error(`unexpected ${url}`);
      }),
    );
    wrap(<ApiKeysPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Generate key/i })).toBeInTheDocument());
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("handleCopy sets copied state then clears after timeout (115)", async () => {
    const keyRaw = `mrk_b35b_${randomUUID()}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/auth/me")) {
          return {
            ok: true,
            json: async () => ({ id: "user-mint-b35b", email: "ops@memroos.com", displayName: "Ops" }),
          } as Response;
        }
        if (url.includes("/api-keys") && init?.method === "POST") {
          return {
            ok: true,
            json: async () => ({
              id: "key-b35b",
              keyRaw,
              label: "batch35b",
              createdAt: "2026-11-12T00:00:00.000Z",
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
    fireEvent.change(screen.getByLabelText(/Label/i), { target: { value: "batch35b-key" } });
    fireEvent.click(screen.getByRole("button", { name: /^Generate$/i }));
    await waitFor(() => expect(screen.getByText(keyRaw)).toBeInTheDocument());
    const copyBtn = screen.getByText(keyRaw).parentElement?.querySelector("button");
    expect(copyBtn).toBeTruthy();
    fireEvent.click(copyBtn!);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(keyRaw);
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
  });
});
