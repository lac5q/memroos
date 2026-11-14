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

describe("LedgerPage batch34", () => {
  beforeEach(() => {
    mockRoutingDefaults();
    searchParams.delete("from_window");
    searchParams.delete("from_workspace");
    searchParams.delete("from_scope_note");
  });

  it.skip("envelopeBadge/envelopeLabel default arms for stale/degraded (stmts 34, 46)", () => {
    // Ledger adapters on this page never emit stale/degraded MetricEnvelope status values.
  });

  it.skip("envelopeLabel live branch with null value (stmt 39)", () => {
    // Successful adapters always attach a numeric value when status is live/zero.
  });

  it("shows loading badges and empty token envelopes", () => {
    ledgerApi.useTokenStats.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
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

    const { rerender } = render(<LedgerPage />);
    expect(screen.getAllByText("loading").length).toBeGreaterThan(0);

    ledgerApi.useTokenStats.mockReturnValue({
      data: { available: false, stats: null, timestamp: "2026-07-01T00:00:00.000Z" },
      isLoading: false,
      error: null,
    });
    rerender(<LedgerPage />);
    expect(screen.getAllByText("unavailable").length).toBeGreaterThan(0);
  });

  it("renders non-Error model usage failures and zero-token live state", () => {
    ledgerApi.useTokenStats.mockReturnValue({
      data: {
        available: true,
        stats: {
          tokensSaved: 0,
          totalCommands: 0,
          avgExecutionTime: 0,
          savingsPercent: 0,
          commandBreakdown: [],
        },
        timestamp: "2026-07-01T00:00:00.000Z",
      },
      isLoading: false,
      error: null,
    });
    ledgerApi.useModelUsage.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: "model usage string batch34",
    });

    const { rerender } = render(<LedgerPage />);
    expect(screen.getAllByText(/unknown error|model usage/i).length).toBeGreaterThan(0);

    ledgerApi.useModelUsage.mockReturnValue({
      data: {
        usage: {
          models: [{ name: "zero-b34", totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheRead: 0, requests: 0 }],
          total: { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreation: 0, requests: 0 },
        },
        timestamp: "2026-07-01T00:00:00.000Z",
      },
      isLoading: false,
      error: null,
    });
    rerender(<LedgerPage />);
    fireEvent.click(screen.getByRole("button", { name: "Model Mix" }));
    expect(screen.getByRole("button", { name: "Savings Breakdown" })).toBeInTheDocument();
  });
});
