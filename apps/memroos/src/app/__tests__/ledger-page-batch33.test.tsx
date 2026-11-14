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

const searchParams = vi.hoisted(() => new URLSearchParams(""));

vi.mock("@/lib/api-client", () => ({ ...ledgerApi }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
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

describe("LedgerPage batch33", () => {
  beforeEach(() => {
    mockRoutingDefaults();
    searchParams.delete("from_window");
    searchParams.delete("from_workspace");
    searchParams.delete("from_scope_note");
  });

  it.skip("envelopeBadge/envelopeLabel default branches (lines 34, 46)", () => {
    // LedgerPage never emits stale/degraded MetricEnvelope values; helpers only use live|zero|empty|blocked|unavailable|error.
  });

  it.skip("envelopeLabel live branch with null value (line 39)", () => {
    // All page adapters avoid live/zero status paired with null value; unreachable without production export of helpers.
  });

  it("shows NOC drilldown banner and non-Error model failure copy", () => {
    searchParams.set("from_window", "24h");
    searchParams.set("from_workspace", "local");
    searchParams.set("from_scope_note", "batch33 scope note");

    ledgerApi.useTokenStats.mockReturnValue({
      data: { available: false, stats: null, timestamp: "2026-07-01T00:00:00.000Z" },
      isLoading: false,
      error: null,
    });
    ledgerApi.useModelUsage.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("model usage failure batch33"),
    });

    render(<LedgerPage />);
    expect(screen.getByText(/Drilldown from Operations NOC/i)).toBeInTheDocument();
    expect(screen.getByText(/batch33 scope note/)).toBeInTheDocument();
    expect(screen.getAllByText(/model usage failure batch33/).length).toBeGreaterThan(0);
  });

  it("switches date range and renders command breakdown savings tab", () => {
    ledgerApi.useTokenStats.mockReturnValue({
      data: {
        available: true,
        stats: {
          tokensSaved: 120,
          totalCommands: 4,
          avgExecutionTime: 12,
          savingsPercent: 8.5,
          commandBreakdown: [
            { command: "rtk explain", count: 2, tokensSaved: 80, savingsPercent: 10 },
          ],
        },
        timestamp: "2026-07-01T00:00:00.000Z",
      },
      isLoading: false,
      error: null,
    });
    ledgerApi.useModelUsage.mockReturnValue({
      data: {
        usage: {
          models: [{ name: "claude-batch33", totalTokens: 900, inputTokens: 400, outputTokens: 500, cacheRead: 0, requests: 1 }],
          total: { inputTokens: 400, outputTokens: 500, cacheRead: 0, cacheCreation: 0, requests: 1 },
        },
        timestamp: "2026-07-01T00:00:00.000Z",
      },
      isLoading: false,
      error: null,
    });

    render(<LedgerPage />);
    fireEvent.change(screen.getByLabelText(/Date range/i), { target: { value: "30" } });
    expect(screen.getByDisplayValue("Last 30 days")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Model Mix" }));
    expect(screen.getByRole("button", { name: "Savings Breakdown" })).toBeInTheDocument();
  });
});
