import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

import ApiKeysPage from "../page";

describe("ApiKeysPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.endsWith("/api/auth/me")) {
          return {
            ok: true,
            json: async () => ({ id: "user-1", email: "ops@memroos.com", displayName: "Ops" }),
          } as Response;
        }
        if (url.includes("/api/users/user-1/api-keys")) {
          return {
            ok: true,
            json: async () => ({
              apiKeys: [
                {
                  id: "key-1",
                  label: "CI token",
                  createdAt: "2026-01-01T00:00:00.000Z",
                  lastUsedAt: null,
                },
              ],
            }),
          } as Response;
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  it("renders API keys header and listed keys", async () => {
    wrap(<ApiKeysPage />);

    expect(screen.getByText("API Keys")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("CI token")).toBeInTheDocument();
    });
  });
});
