import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const api = vi.hoisted(() => ({
  useKnowledgeTrends: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  useKnowledgeTrends: api.useKnowledgeTrends,
}));

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Line: () => null,
}));

import { CollectionTrendsPanel } from "../collection-trends-panel";

describe("CollectionTrendsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state", () => {
    api.useKnowledgeTrends.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = render(<CollectionTrendsPanel />);
    expect(screen.getByText("Collection Activity")).toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("shows empty state", () => {
    api.useKnowledgeTrends.mockReturnValue({ data: { collections: [] }, isLoading: false });
    render(<CollectionTrendsPanel />);
    expect(screen.getByText(/No collection activity data/i)).toBeInTheDocument();
  });

  it("renders trend cards", () => {
    api.useKnowledgeTrends.mockReturnValue({
      isLoading: false,
      data: {
        collections: [
          {
            name: "playbooks",
            category: "product",
            totalFiles: 12,
            recentFiles: 2,
            lastUpdated: "2026-07-01T00:00:00.000Z",
            points: [{ bucket: "2026-07-01", value: 1, cumulative: 1 }],
          },
        ],
      },
    });
    render(<CollectionTrendsPanel />);
    expect(screen.getByText("playbooks")).toBeInTheDocument();
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
  });
});
