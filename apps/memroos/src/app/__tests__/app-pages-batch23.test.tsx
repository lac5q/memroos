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
  useSearchParams: () => new URLSearchParams(""),
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

function mockLedgerBaseline() {
  ledgerApi.useTokenStats.mockReturnValue({
    data: {
      available: true,
      stats: { tokensSaved: 1200, totalCommands: 4, avgExecutionTime: 12, savingsPercent: 8.5 },
      timestamp: "2026-07-01T00:00:00.000Z",
      breakdown: [{ command: "lint", count: 2, tokensSaved: 1200, savingsPercent: 8.5 }],
    },
    isLoading: false,
    error: null,
  });
  ledgerApi.useModelUsage.mockReturnValue({
    data: {
      usage: {
        models: [{ name: "claude", totalTokens: 5000, inputTokens: 2000, outputTokens: 3000, cacheRead: 0, requests: 1 }],
        total: { inputTokens: 2000, outputTokens: 3000, cacheRead: 0, cacheCreation: 0, requests: 1 },
      },
      timestamp: "2026-07-01T00:00:00.000Z",
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

describe("LedgerPage batch23", () => {
  it("renders live savings KPI badges and switches to Model Mix tab", () => {
    mockLedgerBaseline();
    render(<LedgerPage />);
    expect(screen.getAllByText(/1\.2K/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Model Mix" }));
    expect(screen.getAllByText("Model Mix").length).toBeGreaterThan(0);
  });
});

describe("NotebooksPage batch23", () => {
  beforeEach(() => {
    notebooksApi.useMemoryInventory.mockReturnValue({
      data: {
        categories: [
          {
            id: "graph_memory",
            label: "Graph",
            description: "Graph tier",
            count: undefined,
            status: "unavailable",
            sourceOfTruth: "neo4j",
            warnings: [],
            metric: { status: "unavailable", reason: "neo4j offline batch23" },
          },
          {
            id: "episodic",
            label: "Episodic",
            description: "Episodic tier",
            count: 0,
            status: "blocked",
            sourceOfTruth: "sqlite",
            warnings: ["blocked batch23"],
            metric: { status: "blocked", reason: "blocked batch23" },
          },
        ],
        rows: [{ id: "row-batch23", timestamp: "2026-07-01T12:00:00.000Z", category: "graph_memory", label: "Row", tier: "graph" }],
      },
      isLoading: false,
      error: null,
    });
    notebooksApi.useMultiMemorySearch.mockReturnValue({
      data: {
        tiers: [
          { tier: "vector", ok: false, count: 0, metric: { status: "empty" } },
          { tier: "graph", ok: false, count: 0, metric: { status: "blocked" } },
          { tier: "episodic", ok: false, count: 0, metric: { status: "degraded", reason: "degraded batch23" } },
          { tier: "local", ok: false, count: 0, metric: { status: "stale", reason: "stale batch23" } },
          { tier: "wiki", ok: false, count: 0, metric: { status: "unavailable" } },
          { tier: "skills", ok: false, count: 0, metric: { status: "offline" as string } },
        ],
        results: [],
      },
      isLoading: false,
      error: null,
    });
  });

  it("covers unavailable category stats and multi-tier search badge branches", () => {
    render(<NotebooksPage />);
    expect(screen.getAllByText("unavailable").length).toBeGreaterThan(0);
    expect(screen.getByText(/graph blocked/i)).toBeInTheDocument();
    expect(screen.getByText(/episodic degraded/i)).toBeInTheDocument();
    expect(screen.getByText(/local stale/i)).toBeInTheDocument();
    expect(screen.getByText(/wiki unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/skills offline/i)).toBeInTheDocument();
  });
});

describe("WikiPageView batch23", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("view=tree")) {
          return {
            ok: true,
            json: async () => ({
              exists: false,
              wikiRoot: "/vault/batch23-missing",
              tree: [],
            }),
          };
        }
        if (url.includes("view=graph")) {
          return {
            ok: true,
            json: async () => ({
              graph: { exists: false, nodes: [], edges: [], reason: "graph batch23 unavailable" },
            }),
          };
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
  });

  it("shows missing vault banner and graph-unavailable reason", async () => {
    render(<WikiPageView />);
    await waitFor(() => expect(screen.getByText(/Wiki vault not found/i)).toBeInTheDocument());
    expect(screen.getByText(/batch23-missing/)).toBeInTheDocument();
    expect(screen.getByText(/graph batch23 unavailable/i)).toBeInTheDocument();
  });

  it("opens tree file nodes and graph nodes without paths", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("view=tree")) {
        return {
          ok: true,
          json: async () => ({
            exists: true,
            wikiRoot: "/vault/batch23",
            tree: [
              { name: "guide.md", path: "guide.md", type: "file" },
              { name: "nested", path: "nested", type: "dir", children: [{ name: "child.md", path: "nested/child.md", type: "file" }] },
            ],
          }),
        };
      }
      if (url.includes("view=graph")) {
        return {
          ok: true,
          json: async () => ({
            graph: {
              exists: true,
              nodes: [
                { id: "linked", label: "Linked", path: "guide.md" },
                { id: "orphan", label: "Orphan" },
              ],
              edges: [],
            },
          }),
        };
      }
      if (url.includes("view=page")) {
        return {
          ok: false,
          json: async () => ({ ok: false, error: "page_missing_batch23" }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    window.history.replaceState({}, "", "/wiki?path=guide.md");

    render(<WikiPageView />);
    await waitFor(() => expect(screen.getByText("guide.md")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "guide.md" }));
    await waitFor(() => expect(screen.getByText("page_missing_batch23")).toBeInTheDocument());
    expect(screen.getByText("Orphan")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Linked" }));
  });
});
