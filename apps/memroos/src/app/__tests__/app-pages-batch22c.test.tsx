/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ApiKeysPage from "@/app/settings/api-keys/page";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("ApiKeysPage batch22c — error paths", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/auth/me")) {
          return { ok: false, status: 401, json: async () => ({ error: "no session batch22c" }) };
        }
        if (url.includes("/api-keys") && init?.method === "POST") {
          return { ok: false, status: 400, json: async () => ({ error: "label too long batch22c" }) };
        }
        if (url.includes("/api-keys/") && init?.method === "DELETE") {
          return { ok: false, status: 500, json: async () => ({ error: "revoke failed batch22c" }) };
        }
        if (url.includes("/api-keys")) {
          return { ok: true, json: async () => ({ apiKeys: [] }) };
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
  });

  it("surfaces generate and revoke mutation errors when authenticated", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/auth/me")) {
        return { ok: true, json: async () => ({ id: "user-batch22c", email: "u@example.com", displayName: "U" }) };
      }
      if (url.includes("/api-keys") && init?.method === "POST") {
        return { ok: false, status: 400, json: async () => ({ error: "label too long batch22c" }) };
      }
      if (url.includes("/api-keys/") && init?.method === "DELETE") {
        return { ok: false, status: 500, json: async () => ({ error: "revoke failed batch22c" }) };
      }
      if (url.includes("/api-keys")) {
        return {
          ok: true,
          json: async () => ({
            apiKeys: [{ id: "key-revoke", label: "ci", createdAt: "2026-07-01T00:00:00.000Z", lastUsedAt: null }],
          }),
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    wrap(<ApiKeysPage />);
    await waitFor(() => expect(screen.getByText("ci")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Generate key/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Generate$/i }));
    await waitFor(() => expect(screen.getByText(/label too long batch22c/i)).toBeInTheDocument());

    fireEvent.click(screen.getByTitle("Revoke key"));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api-keys/key-revoke"), expect.any(Object)));
  });
});
