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
  useSearchParams: () => new URLSearchParams(),
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

function mockLedgerApis() {
  apiMock.useTokenStats.mockReturnValue({
    data: undefined,
    isLoading: true,
    error: null,
  });
  apiMock.useModelUsage.mockReturnValue({
    data: undefined,
    isLoading: true,
    error: null,
  });
  apiMock.useTimeSeries.mockReturnValue({
    data: { points: [], timestamp: "2026-05-21T00:00:00.000Z" },
    isLoading: false,
    error: null,
  });
  apiMock.useModelRoutingDashboard.mockReturnValue({
    data: {
      events: [],
      summary: {
        totalRuns: 0,
        successfulRuns: 0,
        successRate: null,
        averageQuality: null,
        averageLatencyMs: null,
      },
      timestamp: "2026-05-21T00:00:00.000Z",
    },
    isLoading: false,
    error: null,
  });
  apiMock.useModelRoutingRecommendations.mockReturnValue({
    data: {
      taskType: "engineering",
      strategy: "balanced",
      recommendations: [],
      timestamp: "2026-05-21T00:00:00.000Z",
    },
    isLoading: false,
    error: null,
  });
  apiMock.useModelRoutingEvals.mockReturnValue({
    data: { dimensions: [], referenceTasks: [], summary: null, timestamp: "2026-05-21T00:00:00.000Z" },
    isLoading: false,
    error: null,
  });
}

describe("LedgerPage batch21", () => {
  it("shows blocked loading envelopes while token and model usage are in flight", () => {
    mockLedgerApis();
    render(<LedgerPage />);
    expect(document.querySelectorAll('[data-ledger-kpi-badge="blocked"]').length).toBeGreaterThan(0);
    expect(screen.getAllByText("loading").length).toBeGreaterThan(0);
  });
});
