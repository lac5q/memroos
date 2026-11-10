/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import ApiKeysPage from "../page";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, mutations: { retry: false } } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("ApiKeysPage batch33", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetchApiKeys throws when listing fails (line 41)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/auth/me")) {
          return {
            ok: true,
            json: async () => ({ id: "user-keys-b33", email: "ops@memroos.com", displayName: "Ops" }),
          } as Response;
        }
        if (url.includes("/api/users/user-keys-b33/api-keys") && !init?.method) {
          return { ok: false, status: 503, json: async () => ({ error: "batch33 keys down" }) } as Response;
        }
        throw new Error(`unexpected ${url}`);
      }),
    );

    wrap(<ApiKeysPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Generate key/i })).toBeInTheDocument());
  });

  it("handleCopy is a no-op before a key is minted (line 115)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/auth/me")) {
          return {
            ok: true,
            json: async () => ({ id: "user-b33", email: "ops@memroos.com", displayName: "Ops" }),
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

    const copyCandidates = screen.queryAllByRole("button", { name: /copy/i });
    for (const button of copyCandidates) {
      fireEvent.click(button);
    }
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });
});
