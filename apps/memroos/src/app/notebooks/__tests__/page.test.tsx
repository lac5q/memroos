import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const api = vi.hoisted(() => ({
  useMemoryInventory: vi.fn(),
  useMultiMemorySearch: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  useMemoryInventory: api.useMemoryInventory,
  useMultiMemorySearch: api.useMultiMemorySearch,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/notebooks/memory-list", () => ({
  MemoryList: () => <div data-testid="memory-list" />,
}));


vi.mock("@/components/ui/info-tip", () => ({
  InfoTip: () => null,
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import NotebooksPage from "../page";

describe("NotebooksPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.useMultiMemorySearch.mockReturnValue({
      data: { results: [] },
      isLoading: false,
      isError: false,
    });
  });

  it("shows loading spinner while inventory loads", () => {
    api.useMemoryInventory.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { container } = render(<NotebooksPage />);
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("renders inventory header and widgets when loaded", () => {
    api.useMemoryInventory.mockReturnValue({
      data: {
        categories: [
          {
            id: "vector_memory",
            label: "Vector",
            count: 3,
            status: "ok",
            warnings: [],
            description: "Vector store",
            sourceOfTruth: "qdrant",
            lastUpdated: "2026-07-01",
            metric: { status: "live", count: 3 },
          },
        ],
        rows: [{ id: "r1", timestamp: "2026-07-01T12:00:00.000Z", category: "vector_memory", preview: "x" }],
      },
      isLoading: false,
      isError: false,
    });

    render(<NotebooksPage />);
    expect(screen.getByText("Memory Inventory")).toBeInTheDocument();
    expect(screen.getByTestId("memory-inventory-banner")).toBeInTheDocument();
    expect(screen.getByTestId("memory-list")).toBeInTheDocument();
    expect(screen.getByText("Activity — Last 90 Days")).toBeInTheDocument();
    expect(screen.getByText("Select a memory to view its content.")).toBeInTheDocument();
  });
});
