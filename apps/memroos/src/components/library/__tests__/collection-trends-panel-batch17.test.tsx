/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api-client", () => ({
  useKnowledgeTrends: vi.fn(),
}));

import { CollectionTrendsPanel } from "../collection-trends-panel";
import { useKnowledgeTrends } from "@/lib/api-client";

const mockUseKnowledgeTrends = vi.mocked(useKnowledgeTrends);

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-23T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CollectionTrendsPanel batch17", () => {
  it("shows loading and empty collection states", () => {
    mockUseKnowledgeTrends.mockReturnValue({
      data: { collections: [] },
      isLoading: true,
    } as ReturnType<typeof useKnowledgeTrends>);
    const { rerender } = render(<CollectionTrendsPanel />, { wrapper });
    expect(document.querySelector(".animate-spin")).toBeTruthy();

    mockUseKnowledgeTrends.mockReturnValue({
      data: { collections: [] },
      isLoading: false,
    } as ReturnType<typeof useKnowledgeTrends>);
    rerender(<CollectionTrendsPanel />);
    expect(screen.getByText(/No collection activity data/i)).toBeInTheDocument();
  });

  it("formats freshness labels and switches window toggles", () => {
    mockUseKnowledgeTrends.mockReturnValue({
      data: {
        collections: [
          {
            name: "batch17-never",
            category: "other",
            totalFiles: 10,
            recentFiles: 0,
            lastUpdated: null,
            points: [{ bucket: "2026-10-20", value: 0, cumulative: 0 }],
          },
          {
            name: "batch17-today",
            category: "product",
            totalFiles: 20,
            recentFiles: 3,
            lastUpdated: "2026-10-23T10:00:00.000Z",
            points: [{ bucket: "2026-10-23", value: 2, cumulative: 5 }],
          },
          {
            name: "batch17-yesterday",
            category: "business",
            totalFiles: 8,
            recentFiles: 1,
            lastUpdated: "2026-10-22T08:00:00.000Z",
            points: [{ bucket: "2026-10-22", value: 1, cumulative: 4 }],
          },
          {
            name: "batch17-stale",
            category: "marketing",
            totalFiles: 4,
            recentFiles: 0,
            lastUpdated: "2026-10-10T08:00:00.000Z",
            points: [{ bucket: "2026-10-10", value: 0, cumulative: 1 }],
          },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useKnowledgeTrends>);

    render(<CollectionTrendsPanel />, { wrapper });

    expect(screen.getByText(/never updated/)).toBeInTheDocument();
    expect(screen.getByText(/updated today/)).toBeInTheDocument();
    expect(screen.getByText(/updated yesterday/)).toBeInTheDocument();
    expect(screen.getByText(/13d stale/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(mockUseKnowledgeTrends).toHaveBeenCalledWith("week", 12);
  });
});
