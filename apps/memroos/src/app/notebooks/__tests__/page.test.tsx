import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const api = vi.hoisted(() => ({
  useMemoryInventory: vi.fn(),
  useMultiMemorySearch: vi.fn(),
}));

const navigation = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
}));

vi.mock("@/lib/api-client", () => ({
  useMemoryInventory: api.useMemoryInventory,
  useMultiMemorySearch: api.useMultiMemorySearch,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => navigation.searchParams,
}));

vi.mock("@/components/notebooks/memory-list", () => ({
  MemoryList: () => <div data-testid="memory-list" />,
}));

vi.mock("@/components/notebooks/calendar-heatmap", () => ({
  CalendarHeatmap: () => <div data-testid="calendar-heatmap">Activity — Last 90 Days</div>,
}));

vi.mock("@/components/notebooks/content-viewer", () => ({
  ContentViewer: () => <div>Select a memory to view its content.</div>,
}));

vi.mock("@/components/ui/info-tip", () => ({
  InfoTip: () => null,
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import NotebooksPage from "../page";

function loadedInventory(overrides?: Partial<{ categories: unknown[]; rows: unknown[] }>) {
  api.useMemoryInventory.mockReturnValue({
    data: {
      categories: overrides?.categories ?? [
        {
          id: "vector_memory",
          label: "Vector",
          count: 3,
          status: "ok",
          warnings: ["backend slow"],
          description: "Vector store",
          sourceOfTruth: "qdrant",
          lastUpdated: "2026-07-01",
          metric: { status: "live", count: 3 },
        },
        {
          id: "graph_fact",
          label: "Graph",
          count: 0,
          status: "empty",
          warnings: [],
          description: "Graph facts",
          sourceOfTruth: "neo4j",
          lastUpdated: null,
          metric: { status: "degraded", reason: "neo4j offline" },
        },
      ],
      rows: overrides?.rows ?? [
        { id: "r1", timestamp: "2026-07-01T12:00:00.000Z", category: "vector_memory", preview: "x" },
      ],
    },
    isLoading: false,
    isError: false,
  });
}

describe("NotebooksPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.searchParams = new URLSearchParams();
    api.useMultiMemorySearch.mockReturnValue({
      data: { results: [] },
      isLoading: false,
      isFetching: false,
      isError: false,
    });
  });

  it("shows loading spinner while inventory loads", () => {
    api.useMemoryInventory.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { container } = render(<NotebooksPage />);
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("renders inventory header and widgets when loaded", () => {
    loadedInventory();
    render(<NotebooksPage />);
    expect(screen.getByText("Memory Inventory")).toBeInTheDocument();
    expect(screen.getByTestId("memory-inventory-banner")).toBeInTheDocument();
    expect(screen.getByTestId("memory-list")).toBeInTheDocument();
    expect(screen.getByText("Activity — Last 90 Days")).toBeInTheDocument();
    expect(screen.getByText("Select a memory to view its content.")).toBeInTheDocument();
  });

  it("shows NOC drilldown banner from search params", () => {
    navigation.searchParams = new URLSearchParams(
      "from_window=24h&from_workspace=ops&from_scope_note=Scoped%20note",
    );
    loadedInventory();
    render(<NotebooksPage />);
    expect(screen.getByText(/Drilldown from Operations NOC/)).toBeInTheDocument();
    expect(screen.getByText(/Scoped note/)).toBeInTheDocument();
  });

  it("submits memory search and renders tier badges and results", () => {
    loadedInventory();
    api.useMultiMemorySearch.mockImplementation((query: string) => ({
      data:
        query === "pipeline"
          ? {
              results: [
                {
                  id: "m1",
                  tier: "vector",
                  title: "Pipeline status",
                  content: "All green",
                  score: 0.912,
                  source: "mem0",
                },
              ],
              tiers: [
                { tier: "vector", ok: true, count: 1, metric: { status: "live" } },
                { tier: "graph", ok: false, count: 0, metric: { status: "blocked", reason: "neo4j down" } },
                { tier: "episodic", ok: false, count: 0, error: "sqlite locked", metric: { status: "error" } },
              ],
            }
          : { results: [] },
      isLoading: false,
      isFetching: false,
      isError: query === "fail",
    }));

    render(<NotebooksPage />);
    fireEvent.change(screen.getByLabelText("Search all memory tiers"), { target: { value: "pipeline" } });
    fireEvent.click(screen.getByRole("button", { name: "Search Memory" }));

    expect(screen.getByText("Pipeline status")).toBeInTheDocument();
    expect(screen.getByText("0.91")).toBeInTheDocument();
    expect(screen.getByText(/vector 1 hits/)).toBeInTheDocument();
    expect(screen.getByText(/graph blocked/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search all memory tiers"), { target: { value: "fail" } });
    fireEvent.click(screen.getByRole("button", { name: "Search Memory" }));
    expect(screen.getByText(/Memory search failed/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search all memory tiers"), { target: { value: "missing" } });
    fireEvent.click(screen.getByRole("button", { name: "Search Memory" }));
    expect(screen.getByText(/No retained context found/i)).toBeInTheDocument();
  });

  it("switches category filters", () => {
    loadedInventory();
    render(<NotebooksPage />);
    fireEvent.click(screen.getByRole("button", { name: "Graph" }));
    expect(api.useMemoryInventory).toHaveBeenLastCalledWith({ category: "graph_fact" });
  });
});
