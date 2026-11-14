/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api-client", () => ({
  useKnowledgeTrends: vi.fn(() => ({
    data: {
      collections: [
        {
          name: "trend-b32",
          category: "business",
          totalFiles: 12,
          recentFiles: 2,
          lastUpdated: "2026-10-23T10:00:00.000Z",
          points: [{ bucket: "2026-10-23", value: 2, cumulative: 5 }],
        },
      ],
    },
    isLoading: false,
  })),
}));

vi.mock("recharts", () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: ({ content }: { content: React.ReactElement }) => {
    const Comp = content.type as React.ComponentType<{
      active?: boolean;
      payload?: Array<{ value: number; payload: { cumulative: number } }>;
      label?: string;
    }>;
    return <Comp active label="Oct 23" payload={[{ value: 3, payload: { cumulative: 9 } }]} />;
  },
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { CollectionTrendsPanel } from "../collection-trends-panel";

describe("CollectionTrendsPanel batch32", () => {
  it("renders trend tooltip copy (line 49)", () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <CollectionTrendsPanel />
      </QueryClientProvider>,
    );
    expect(screen.getByText("Oct 23")).toBeInTheDocument();
    expect(screen.getByText("3 new/updated")).toBeInTheDocument();
    expect(screen.getByText("9 in window")).toBeInTheDocument();
  });
});
