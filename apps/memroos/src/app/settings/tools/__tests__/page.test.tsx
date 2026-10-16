import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

import ConnectedToolsPage from "../page";

describe("ConnectedToolsPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/api/tools/providers")) {
          return {
            ok: true,
            json: async () => ({ providers: [{ key: "github", label: "GitHub", authMode: "oauth" }] }),
          } as Response;
        }
        if (url.includes("/api/tools/connections")) {
          return { ok: true, json: async () => ({ connections: [] }) } as Response;
        }
        if (url.includes("/api/tools/activity")) {
          return { ok: true, json: async () => ({ events: [] }) } as Response;
        }
        if (url.includes("/api/tools/usage")) {
          return { ok: true, json: async () => ({ usage: null, approachingLimit: false }) } as Response;
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  it("renders connected tools header", async () => {
    wrap(<ConnectedToolsPage />);
    expect(screen.getByText("Connected Tools")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search providers/i)).toBeInTheDocument();
    });
  });

  it("lists providers from API", async () => {
    wrap(<ConnectedToolsPage />);
    await waitFor(() => {
      expect(screen.getByText("GitHub")).toBeInTheDocument();
    });
  });
});
