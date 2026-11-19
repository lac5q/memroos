import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  useTokenStats: vi.fn(),
  useModelUsage: vi.fn(),
  useTimeSeries: vi.fn(),
  useModelRoutingDashboard: vi.fn(),
  useModelRoutingEvals: vi.fn(),
  useModelRoutingRecommendations: vi.fn(),
}));

vi.mock("@/lib/api-client", () => apiMock);

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

import LedgerPage from "@/app/ledger/page";

describe("LedgerPage batch22d — envelope error and unavailable labels", () => {
  it("shows unavailable labels when token stats error and model usage is empty", () => {
    apiMock.useTokenStats.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("rtk down batch22d"),
    });
    apiMock.useModelUsage.mockReturnValue({
      data: { usage: { models: [], total: { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreation: 0, requests: 0 } }, timestamp: null },
      isLoading: false,
      error: null,
    });
    apiMock.useTimeSeries.mockReturnValue({ data: { points: [] }, isLoading: false, error: null });
    apiMock.useModelRoutingDashboard.mockReturnValue({
      data: { events: [], summary: { totalRuns: 0, successfulRuns: 0, successRate: null, averageQuality: null, averageLatencyMs: null }, timestamp: null },
      isLoading: false,
      error: null,
    });
    apiMock.useModelRoutingRecommendations.mockReturnValue({
      data: { taskType: "engineering", strategy: "balanced", recommendations: [], timestamp: null },
      isLoading: false,
      error: null,
    });
    apiMock.useModelRoutingEvals.mockReturnValue({
      data: { dimensions: [], referenceTasks: [], summary: null, timestamp: null },
      isLoading: false,
      error: null,
    });

    render(<LedgerPage />);
    expect(screen.getAllByText(/unavailable/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/rtk down batch22d/i).length).toBeGreaterThan(0);
  });
});
