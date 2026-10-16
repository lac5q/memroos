import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("shows empty-state copy when search matches no providers", async () => {
    wrap(<ConnectedToolsPage />);
    await waitFor(() => expect(screen.getByPlaceholderText(/Search providers/i)).toBeInTheDocument());
    const input = screen.getByPlaceholderText(/Search providers/i);
    await waitFor(() => expect(screen.getByText("GitHub")).toBeInTheDocument());
    fireEvent.change(input, { target: { value: "zzzz-no-match" } });
    await waitFor(() => {
      expect(screen.getByText(/No providers match/i)).toBeInTheDocument();
    });
  });

});

describe("ConnectedToolsPage enriched dashboard state", () => {
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
          return {
            ok: true,
            json: async () => ({
              events: [
                {
                  id: "evt-1",
                  providerKey: "github",
                  type: "test_succeeded",
                  at: new Date().toISOString(),
                },
              ],
            }),
          } as Response;
        }
        if (url.includes("/api/tools/usage")) {
          return {
            ok: true,
            json: async () => ({
              usage: { used: 4, limit: 5, plan: "starter" },
              approachingLimit: true,
            }),
          } as Response;
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  it("renders usage meter, recent activity, and empty-connection guidance", async () => {
    wrap(<ConnectedToolsPage />);
    await waitFor(() => {
      expect(screen.getByText("4 of 5 connections used")).toBeInTheDocument();
      expect(screen.getByText("RECENT ACTIVITY")).toBeInTheDocument();
      expect(screen.getByText("test passed")).toBeInTheDocument();
      expect(screen.getByText(/No tools connected yet/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Upgrade Nango plan/i })).toBeInTheDocument();
    });
  });
});
