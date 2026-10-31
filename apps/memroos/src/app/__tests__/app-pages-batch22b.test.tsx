/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ledgerApi = vi.hoisted(() => ({
  useTokenStats: vi.fn(),
  useModelUsage: vi.fn(),
  useTimeSeries: vi.fn(),
  useModelRoutingDashboard: vi.fn(),
  useModelRoutingEvals: vi.fn(),
  useModelRoutingRecommendations: vi.fn(),
}));

const notebooksApi = vi.hoisted(() => ({
  useMemoryInventory: vi.fn(),
  useMultiMemorySearch: vi.fn(),
}));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

vi.mock("@/lib/api-client", () => ({
  ...ledgerApi,
  ...notebooksApi,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams(
      "from_window=7d&from_workspace=cloud&from_scope_note=batch22b+memory+drilldown&q=seed-query",
    ),
}));

vi.mock("recharts", () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => null,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: () => null,
  Cell: () => null,
}));

vi.mock("@/components/notebooks/memory-list", () => ({ MemoryList: () => <div data-testid="memory-list" /> }));
vi.mock("@/components/notebooks/calendar-heatmap", () => ({ CalendarHeatmap: () => null }));
vi.mock("@/components/notebooks/content-viewer", () => ({ ContentViewer: () => null }));
vi.mock("react-markdown", () => ({ default: ({ children }: { children: string }) => <div>{children}</div> }));

import LedgerPage from "@/app/ledger/page";
import NotebooksPage from "@/app/notebooks/page";
import WikiPageView from "@/app/wiki/page";
import ApiKeysPage from "@/app/settings/api-keys/page";

function mockLedgerHooks() {
  ledgerApi.useTokenStats.mockReturnValue({
    data: { available: false, stats: null, timestamp: "2026-05-21T00:00:00.000Z" },
    isLoading: false,
    error: new Error("rtk offline batch22b"),
  });
  ledgerApi.useModelUsage.mockReturnValue({
    data: {
      usage: {
        models: [{ name: "claude", totalTokens: 2_500_000, inputTokens: 1_000_000, outputTokens: 1_500_000, cacheRead: 0, requests: 2 }],
        total: { inputTokens: 1_000_000, outputTokens: 1_500_000, cacheRead: 0, cacheCreation: 0, requests: 2 },
      },
      timestamp: "2026-05-21T00:00:00.000Z",
    },
    isLoading: false,
    error: null,
  });
  ledgerApi.useTimeSeries.mockReturnValue({ data: { points: [] }, isLoading: false, error: null });
  ledgerApi.useModelRoutingDashboard.mockReturnValue({
    data: { events: [], summary: { totalRuns: 0, successfulRuns: 0, successRate: null, averageQuality: null, averageLatencyMs: null }, timestamp: "" },
    isLoading: false,
    error: null,
  });
  ledgerApi.useModelRoutingRecommendations.mockReturnValue({
    data: { taskType: "engineering", strategy: "balanced", recommendations: [], timestamp: "" },
    isLoading: false,
    error: null,
  });
  ledgerApi.useModelRoutingEvals.mockReturnValue({
    data: { dimensions: [], referenceTasks: [], summary: null, timestamp: "" },
    isLoading: false,
    error: null,
  });
}

describe("LedgerPage batch22b", () => {
  it("shows unavailable RTK envelopes while model usage stays live", () => {
    mockLedgerHooks();
    render(<LedgerPage />);
    expect(screen.getAllByText("unavailable").length).toBeGreaterThan(0);
    expect(screen.getByText(/2\.5M/i)).toBeInTheDocument();
  });
});

describe("NotebooksPage batch22b", () => {
  beforeEach(() => {
    notebooksApi.useMemoryInventory.mockReturnValue({
      data: {
        categories: [
          {
            id: "vector_memory",
            label: "Vector",
            description: "Vector tier",
            count: "unknown",
            status: "degraded",
            sourceOfTruth: "mem0",
            warnings: ["backend timeout batch22b"],
            metric: { status: "degraded", reason: "timeout batch22b" },
          },
        ],
        rows: [{ id: "row-1", timestamp: "2026-07-01T12:00:00.000Z", category: "vector_memory", label: "Row", tier: "vector" }],
      },
      isLoading: false,
      error: null,
    });
    notebooksApi.useMultiMemorySearch.mockReturnValue({
      data: {
        tiers: [
          { tier: "vector", ok: false, count: 0, error: "vector down batch22b", metric: { status: "error", reason: "vector down batch22b" } },
        ],
        results: [],
      },
      isLoading: false,
      error: null,
    });
  });

  it("renders NOC drilldown, degraded category stats, and tier badges", () => {
    render(<NotebooksPage />);
    expect(screen.getByText(/batch22b memory drilldown/i)).toBeInTheDocument();
    expect(screen.getByText(/unknown/)).toBeInTheDocument();
    expect(screen.getByText(/vector error/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Search all memory tiers/i), { target: { value: "batch22b query" } });
    fireEvent.submit(screen.getByLabelText(/Search all memory tiers/i).closest("form")!);
    expect(screen.getByDisplayValue("batch22b query")).toBeInTheDocument();
  });
});

describe("WikiPageView batch22b", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("view=tree")) {
          return {
            ok: true,
            json: async () => ({
              exists: true,
              wikiRoot: "/vault/batch22b",
              tree: [{ name: "docs", path: "docs", type: "dir", children: [{ name: "index.md", path: "index.md", type: "file" }] }],
            }),
          };
        }
        if (url.includes("view=graph")) {
          return {
            ok: true,
            json: async () => ({
              graph: {
                exists: true,
                nodes: [{ id: "n1", label: "Index", path: "index.md" }],
                edges: [{ source: "n1", target: "n2" }],
              },
            }),
          };
        }
        if (url.includes("view=page")) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              page: { path: "index.md", title: "Batch22b Wiki", content: "Hello [[Other|alias batch22b]]", mtime: null },
            }),
          };
        }
        if (url.includes("view=search")) {
          return {
            ok: true,
            json: async () => ({
              hits: [{ path: "index.md", title: "Batch22b Wiki", snippet: "Hello batch22b" }],
            }),
          };
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    window.history.replaceState({}, "", "/wiki?path=index.md");
  });

  it("loads tree, search hits, and wikilink markdown", async () => {
    render(<WikiPageView />);
    await waitFor(() => expect(screen.getByText("Batch22b Wiki")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Search wiki/i), { target: { value: "batch22b" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByText(/Hello batch22b/i)).toBeInTheDocument());
    expect(screen.getByText(/alias batch22b/)).toBeInTheDocument();
    expect(screen.getByText(/1 edge/i)).toBeInTheDocument();
  });
});

describe("ApiKeysPage batch22b", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/auth/me")) {
          return { ok: true, json: async () => ({ id: "user-batch22b", email: "u@example.com", displayName: "U" }) };
        }
        if (url.includes("/api-keys") && init?.method === "POST") {
          return {
            ok: true,
            json: async () => ({
              id: "key-batch22b",
              keyRaw: "mk_batch22b_secret",
              label: "ci",
              createdAt: "2026-07-01T00:00:00.000Z",
            }),
          };
        }
        if (url.includes("/api-keys") && (!init || !init.method)) {
          return {
            ok: true,
            json: async () => ({
              apiKeys: [
                {
                  id: "key-existing",
                  label: "",
                  createdAt: "2026-06-01T00:00:00.000Z",
                  lastUsedAt: "2026-06-15T00:00:00.000Z",
                },
              ],
            }),
          };
        }
        if (url.includes("/api-keys/") && init?.method === "DELETE") {
          return { ok: true, status: 204 };
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("generates a key, copies it, and revokes listed keys", async () => {
    wrap(<ApiKeysPage />);
    await waitFor(() => expect(screen.getByText(/Unlabeled/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Generate key/i }));
    fireEvent.change(screen.getByLabelText(/Label/i), { target: { value: "ci batch22b" } });
    fireEvent.click(screen.getByRole("button", { name: /^Generate$/i }));
    await waitFor(() => expect(screen.getByText("mk_batch22b_secret")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Done/i }));
    fireEvent.click(screen.getByTitle("Revoke key"));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api-keys/key-existing"), expect.objectContaining({ method: "DELETE" })));
  });
});
