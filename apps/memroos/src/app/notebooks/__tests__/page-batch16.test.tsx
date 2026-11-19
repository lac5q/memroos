/**
 * @vitest-environment jsdom
 */
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
  MemoryList: () => <div data-testid="memory-list-batch16" />,
}));

vi.mock("@/components/notebooks/calendar-heatmap", () => ({
  CalendarHeatmap: () => null,
}));

vi.mock("@/components/notebooks/content-viewer", () => ({
  ContentViewer: () => null,
}));

vi.mock("@/components/ui/info-tip", () => ({
  InfoTip: () => null,
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import NotebooksPage from "../page";

function loadedInventory(categories: unknown[]) {
  api.useMemoryInventory.mockReturnValue({
    data: {
      categories,
      rows: [{ id: "r-batch16", timestamp: "2026-10-01T08:00:00.000Z", category: "vector_memory" }],
    },
    isLoading: false,
    isError: false,
  });
}

describe("NotebooksPage batch16", () => {
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

  it("maps category metric statuses to stat tones and display values", () => {
    loadedInventory([
      {
        id: "vector_memory",
        label: "Vector",
        count: 12,
        status: "ok",
        warnings: [],
        description: "Vector",
        sourceOfTruth: "qdrant",
        metric: { status: "live" },
      },
      {
        id: "graph_fact",
        label: "Graph Empty",
        count: 0,
        status: "empty",
        warnings: [],
        description: "Graph",
        sourceOfTruth: "neo4j",
        metric: { status: "empty" },
      },
      {
        id: "episodic_write",
        label: "Episodic Degraded",
        count: null,
        status: "degraded",
        warnings: ["sqlite locked"],
        description: "Episodic",
        sourceOfTruth: "sqlite",
        metric: { status: "degraded", reason: "sqlite locked" },
      },
      {
        id: "knowledge_file",
        label: "Knowledge Stale",
        count: 4,
        status: "stale",
        warnings: [],
        description: "Files",
        sourceOfTruth: "disk",
        metric: { status: "stale" },
      },
      {
        id: "ingested_message",
        label: "Messages Unknown",
        count: undefined,
        status: "blocked",
        warnings: [],
        description: "Messages",
        sourceOfTruth: "ingest",
        metric: { status: "blocked" },
      },
    ]);

    render(<NotebooksPage />);
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
    expect(screen.getAllByText("unknown").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("renders multi-tier search badges for stale, unavailable, zero, and offline statuses", () => {
    loadedInventory([
      {
        id: "vector_memory",
        label: "Vector",
        count: 1,
        status: "ok",
        warnings: [],
        description: "Vector",
        sourceOfTruth: "qdrant",
        metric: { status: "live" },
      },
    ]);

    api.useMultiMemorySearch.mockImplementation((query: string) => ({
      data:
        query === "batch16-tiers"
          ? {
              results: [],
              tiers: [
                { tier: "vector", ok: true, count: 2, metric: { status: "live" } },
                { tier: "graph", ok: false, count: 0, metric: { status: "stale", reason: "lag" } },
                { tier: "episodic", ok: false, count: 0, metric: { status: "unavailable", reason: "down" } },
                { tier: "local", ok: true, count: 0, metric: { status: "zero" } },
                { tier: "archive", ok: false, count: 0, metric: { status: "offline" } },
              ],
            }
          : { results: [] },
      isLoading: false,
      isFetching: false,
      isError: false,
    }));

    render(<NotebooksPage />);
    fireEvent.change(screen.getByLabelText("Search all memory tiers"), {
      target: { value: "batch16-tiers" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search Memory" }));

    expect(screen.getByText(/vector 2 hits/)).toBeInTheDocument();
    expect(screen.getByText(/graph stale/)).toBeInTheDocument();
    expect(screen.getByText(/episodic unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/local 0/)).toBeInTheDocument();
    expect(screen.getByText(/archive offline/)).toBeInTheDocument();
  });
});
