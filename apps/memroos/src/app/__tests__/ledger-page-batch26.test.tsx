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

vi.mock("@/lib/api-client", () => ({ ...ledgerApi }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("from_window=24h&from_workspace=local"),
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
}

describe("LedgerPage batch26", () => {
  beforeEach(() => {
    mockRoutingDefaults();
  });

  it("shows NOC drilldown defaults and model-usage error envelopes", () => {
    ledgerApi.useTokenStats.mockReturnValue({
      data: { available: true, stats: { tokensSaved: 0, totalCommands: 0, avgExecutionTime: 0, savingsPercent: 0 }, timestamp: "2026-07-01T00:00:00.000Z" },
      isLoading: false,
      error: null,
    });
    ledgerApi.useModelUsage.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("model usage batch26 down"),
    });

    render(<LedgerPage />);
    expect(screen.getByText(/Drilldown from Operations NOC/i)).toBeInTheDocument();
    expect(screen.getByText(/NOT applied to the data below/i)).toBeInTheDocument();
    expect(screen.getAllByText(/model usage batch26 down/i).length).toBeGreaterThan(0);
    expect(document.querySelector('[data-ledger-kpi-badge="error"]')).toBeTruthy();
  });

  it("formats large token totals and switches the date-range filter", () => {
    ledgerApi.useTokenStats.mockReturnValue({
      data: {
        available: true,
        stats: {
          tokensSaved: 1_500_000,
          totalCommands: 12,
          avgExecutionTime: 0.4,
          savingsPercent: 8.5,
          commandBreakdown: [{ command: "rtk run", count: 2, tokensSaved: 50, savingsPercent: 10 }],
        },
        timestamp: "2026-07-01T00:00:00.000Z",
      },
      isLoading: false,
      error: null,
    });
    ledgerApi.useModelUsage.mockReturnValue({
      data: {
        usage: {
          models: [{ name: "claude", totalTokens: 2_500_000, inputTokens: 1_000_000, outputTokens: 1_500_000, cacheRead: 0, requests: 3 }],
          total: { inputTokens: 1_000_000, outputTokens: 1_500_000, cacheRead: 0, cacheCreation: 0, requests: 3 },
        },
        timestamp: "2026-07-01T00:00:00.000Z",
      },
      isLoading: false,
      error: null,
    });

    render(<LedgerPage />);
    expect(screen.getAllByText(/1\.5M/i).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText(/Date range/i), { target: { value: "30" } });
    expect(screen.getByText(/window=30d/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Model Mix" }));
    expect(screen.getByText(/Claude JSONL \+ efficiency token_ledger/i)).toBeInTheDocument();
  });

  it("renders empty model-mix and RTK-missing unavailable reasons", () => {
    ledgerApi.useTokenStats.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("rtk batch26 unavailable"),
    });
    ledgerApi.useModelUsage.mockReturnValue({
      data: {
        usage: { models: [], total: { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreation: 0, requests: 0 } },
        timestamp: "2026-07-01T00:00:00.000Z",
      },
      isLoading: false,
      error: null,
    });

    render(<LedgerPage />);
    expect(screen.getAllByText("no data").length).toBeGreaterThan(0);
    expect(screen.getAllByText("unavailable").length).toBeGreaterThan(0);
    expect(document.querySelectorAll("[data-ledger-kpi-reason]").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/rtk batch26 unavailable/i).length).toBeGreaterThan(0);
  });
});
