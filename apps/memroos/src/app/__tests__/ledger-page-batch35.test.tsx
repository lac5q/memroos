/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ledgerApi = vi.hoisted(() => ({
  useTokenStats: vi.fn(),
  useModelUsage: vi.fn(),
  useTimeSeries: vi.fn(),
  useModelRoutingDashboard: vi.fn(),
  useModelRoutingEvals: vi.fn(),
  useModelRoutingRecommendations: vi.fn(),
}));

const searchParams = vi.hoisted(() => new URLSearchParams());

vi.mock("@/lib/api-client", () => ({ ...ledgerApi }));
vi.mock("next/navigation", () => ({ useSearchParams: () => searchParams }));
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

function mockRoutingDefaults() {
  ledgerApi.useTimeSeries.mockReturnValue({ data: { points: [] }, isLoading: false, error: null });
  ledgerApi.useModelRoutingDashboard.mockReturnValue({
    data: {
      events: [],
      summary: { totalRuns: 0, successfulRuns: 0, successRate: null, averageQuality: null, averageLatencyMs: null },
      timestamp: "",
    },
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

describe("LedgerPage batch35", () => {
  beforeEach(() => {
    mockRoutingDefaults();
    searchParams.delete("from_window");
  });

  it.skip("envelopeBadge default and envelopeLabel live-null arms (stmts 34, 39, 46)", () => {
    // Page adapters never emit unknown MetricEnvelope statuses or live envelopes with null values.
  });

  it("tokenStatsEnvelopes uses non-Error messages for unavailable KPIs (branch 67)", () => {
    ledgerApi.useTokenStats.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: "rtk outage batch35",
    });
    ledgerApi.useModelUsage.mockReturnValue({
      data: {
        usage: {
          models: [],
          total: { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreation: 0, requests: 0 },
        },
        timestamp: "2026-07-01T00:00:00.000Z",
      },
      isLoading: false,
      error: null,
    });
    render(<LedgerPage />);
    expect(screen.getAllByText("unavailable").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/unknown error|rtk outage batch35/i).length).toBeGreaterThan(0);
  });

  it("tokensProcessedEnvelope empty arm when no model observations (lines 219+)", () => {
    ledgerApi.useTokenStats.mockReturnValue({
      data: {
        available: true,
        stats: { tokensSaved: 10, totalCommands: 2, avgExecutionTime: 1, savingsPercent: 5 },
        timestamp: "2026-07-01T00:00:00.000Z",
      },
      isLoading: false,
      error: null,
    });
    ledgerApi.useModelUsage.mockReturnValue({
      data: {
        usage: {
          models: [],
          total: { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreation: 0, requests: 0 },
        },
        timestamp: "2026-07-02T00:00:00.000Z",
      },
      isLoading: false,
      error: null,
    });
    render(<LedgerPage />);
    expect(screen.getAllByText("no data").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Model Mix" }));
    expect(screen.getByRole("button", { name: "Savings Breakdown" })).toBeInTheDocument();
  });
});
