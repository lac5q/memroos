/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ledgerApi = vi.hoisted(() => ({
  useTokenStats: vi.fn(),
  useModelUsage: vi.fn(),
  useTimeSeries: vi.fn(),
  useModelRoutingDashboard: vi.fn(),
  useModelRoutingEvals: vi.fn(),
  useModelRoutingRecommendations: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({ ...ledgerApi }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("") }));
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
vi.mock("@/components/ledger/savings-chart", () => ({ SavingsChart: () => null }));
vi.mock("@/components/ledger/model-mix-chart", () => ({ ModelMixChart: () => null }));
vi.mock("@/components/ledger/cost-calculator", () => ({ CostCalculator: () => null }));
vi.mock("@/components/ledger/analytics-panel", () => ({ LedgerAnalyticsPanel: () => null }));
vi.mock("@/components/ledger/model-routing-panel", () => ({ ModelRoutingPanel: () => null }));

import LedgerPage from "@/app/ledger/page";

describe("LedgerPage batch24", () => {
  beforeEach(() => {
    ledgerApi.useModelUsage.mockReturnValue({
      data: {
        usage: { models: [], total: { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreation: 0, requests: 0 } },
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
  });

  it("shows unavailable and degraded envelope labels for token stats", () => {
    ledgerApi.useTokenStats.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("tokens down batch24"),
    });
    const { rerender } = render(<LedgerPage />);
    expect(screen.getAllByText("unavailable").length).toBeGreaterThan(0);

    ledgerApi.useTokenStats.mockReturnValue({
      data: { available: true, stats: null, timestamp: "2026-07-01T00:00:00.000Z" },
      isLoading: true,
      error: null,
    });
    rerender(<LedgerPage />);
    expect(screen.getAllByText("loading").length).toBeGreaterThan(0);
  });
});
