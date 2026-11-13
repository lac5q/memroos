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

describe("LedgerPage batch27", () => {
  beforeEach(() => {
    mockRoutingDefaults();
  });

  it("formats billion and thousand token totals and shows model-usage error labels", () => {
    ledgerApi.useTokenStats.mockReturnValue({
      data: {
        available: true,
        stats: {
          tokensSaved: 2_500_000_000,
          totalCommands: 4_200,
          avgExecutionTime: 0.2,
          savingsPercent: 0,
        },
        timestamp: "2026-07-01T00:00:00.000Z",
      },
      isLoading: false,
      error: null,
    });
    ledgerApi.useModelUsage.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("model usage batch27 fault"),
    });

    render(<LedgerPage />);
    expect(screen.getAllByText(/2\.5B/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/4\.2K/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("error").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/model usage batch27 fault/i).length).toBeGreaterThan(0);
    expect(document.querySelector('[data-ledger-kpi-badge="error"]')).toBeTruthy();
  });

  it("shows measured-zero savings percent when RTK stats report zero", () => {
    ledgerApi.useTokenStats.mockReturnValue({
      data: {
        available: true,
        stats: {
          tokensSaved: 0,
          totalCommands: 0,
          avgExecutionTime: 0,
          savingsPercent: 0,
        },
        timestamp: "2026-07-01T00:00:00.000Z",
      },
      isLoading: false,
      error: null,
    });
    ledgerApi.useModelUsage.mockReturnValue({
      data: {
        usage: {
          models: [{ name: "claude", totalTokens: 900, inputTokens: 400, outputTokens: 500, cacheRead: 0, requests: 1 }],
          total: { inputTokens: 400, outputTokens: 500, cacheRead: 0, cacheCreation: 0, requests: 1 },
        },
        timestamp: "2026-07-01T00:00:00.000Z",
      },
      isLoading: false,
      error: null,
    });

    render(<LedgerPage />);
    expect(document.querySelectorAll('[data-ledger-kpi-badge="zero"]').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/measured zero/i).length).toBeGreaterThan(0);
  });
});
