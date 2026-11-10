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

describe("ApiKeysPage batch33b", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("handleCopy writes minted key and clears copied state (lines 115-118)", async () => {
    const rawKey = "mrk_batch33b_copy_key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/auth/me")) {
          return {
            ok: true,
            json: async () => ({ id: "user-copy-b33b", email: "ops@memroos.com", displayName: "Ops" }),
          } as Response;
        }
        if (url.includes("/api-keys") && init?.method === "POST") {
          return { ok: true, json: async () => ({ keyRaw: rawKey, id: "key-1" }) } as Response;
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
    const labelInput = await screen.findByPlaceholderText(/CI\/CD pipeline/i);
    fireEvent.change(labelInput, { target: { value: "batch33b" } });
    fireEvent.click(screen.getByRole("button", { name: /^Generate$/i }));

    await waitFor(() => expect(screen.getByText(rawKey)).toBeInTheDocument());
    fireEvent.click(screen.getByText(rawKey).parentElement!.querySelector("button")!);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(rawKey);

    await vi.advanceTimersByTimeAsync(2000);
    await waitFor(() => expect(screen.queryByText(/Copied!/i)).not.toBeInTheDocument());
  });
});
