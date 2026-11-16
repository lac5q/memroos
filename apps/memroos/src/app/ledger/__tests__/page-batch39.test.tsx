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

describe("LedgerPage batch39", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRoutingDefaults();
  });

  it("renders empty KPI labels when model usage has no observations", () => {
    ledgerApi.useTokenStats.mockReturnValue({
      data: { available: true, stats: { tokensSaved: 0, totalCommands: 0, avgExecutionTime: 0, savingsPercent: 0 }, timestamp: "2026-11-16T00:00:00.000Z" },
      isLoading: false,
      error: null,
    });
    ledgerApi.useModelUsage.mockReturnValue({
      data: {
        usage: { total: { inputTokens: 0, outputTokens: 0, cacheRead: 0, requests: 0 }, models: [] },
        timestamp: "2026-11-16T00:00:00.000Z",
      },
      isLoading: false,
      error: null,
    });

    render(<LedgerPage />);
    expect(screen.getAllByText("no data").length).toBeGreaterThan(0);
  });

  it.skip("envelopeBadge/envelopeLabel default arms (page.tsx ~34,46) — tokenStatsEnvelopes/tokensProcessedEnvelope never emit stale|degraded; hooks cannot drive those statuses without production adapter changes", () => {});
});