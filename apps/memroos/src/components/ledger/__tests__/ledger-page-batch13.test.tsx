import { fireEvent, render, screen } from "@testing-library/react";
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

const searchParamsMock = vi.hoisted(() => ({
  params: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsMock.params,
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

function mockLedgerApis(overrides: {
  token?: Partial<ReturnType<typeof apiMock.useTokenStats>>;
  model?: Partial<ReturnType<typeof apiMock.useModelUsage>>;
} = {}) {
  apiMock.useTokenStats.mockReturnValue({
    data: { stats: {}, timestamp: "2026-05-21T00:00:00.000Z" },
    isLoading: false,
    error: null,
    ...overrides.token,
  });
  apiMock.useModelUsage.mockReturnValue({
    data: {
      usage: {
        models: [],
        total: { inputTokens: 0, outputTokens: 0, cacheRead: 0, requests: 0 },
      },
      timestamp: "2026-05-21T00:00:00.000Z",
    },
    isLoading: false,
    error: null,
    ...overrides.model,
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

describe("LedgerPage batch13 coverage", () => {
  it("formats large token totals and shows savings rate subtitle", () => {
    mockLedgerApis({
      token: {
        data: {
          stats: {
            tokensSaved: 0,
            savingsPercent: 18.2,
            totalCommands: 0,
            avgExecutionTime: 0,
            commandBreakdown: [{ command: "rtk run", count: 1, tokensSaved: 0, savingsPercent: 0 }],
          },
          timestamp: "2026-05-21T00:00:00.000Z",
        },
      },
      model: {
        data: {
          usage: {
            models: [{ name: "claude-opus", totalTokens: 2_500_000_000 }],
            total: {
              inputTokens: 1_500_000,
              outputTokens: 750_000,
              cacheRead: 250_000,
              requests: 99,
            },
          },
          timestamp: "2026-05-21T00:00:00.000Z",
        },
      },
    });

    render(<LedgerPage />);
    expect(screen.getByText(/1\.5M in \/ 750\.0K out/i)).toBeInTheDocument();
    expect(screen.getByText(/18\.2% savings rate/i)).toBeInTheDocument();
    expect(document.querySelector('[data-ledger-kpi-badge="live"]')).toBeTruthy();
  });

  it("surfaces model-usage errors while RTK token stats stay optional", () => {
    mockLedgerApis({
      token: { data: { stats: null, available: false }, error: null },
      model: { error: new Error("model usage down"), data: undefined },
    });

    render(<LedgerPage />);
    expect(screen.getByText(/Model usage failed: model usage down/i)).toBeInTheDocument();
    expect(document.querySelector('[data-ledger-kpi-badge="error"]')).toBeTruthy();
  });

  it("shows measured-zero RTK envelopes when stats are explicitly zero", () => {
    mockLedgerApis({
      token: {
        data: {
          stats: {
            tokensSaved: 0,
            savingsPercent: 0,
            totalCommands: 0,
            avgExecutionTime: 0,
            commandBreakdown: [],
          },
          timestamp: "2026-05-21T00:00:00.000Z",
        },
      },
      model: {
        data: {
          usage: {
            models: [{ name: "claude-haiku", totalTokens: 0 }],
            total: { inputTokens: 0, outputTokens: 0, cacheRead: 0, requests: 1 },
          },
          timestamp: "2026-05-21T00:00:00.000Z",
        },
      },
    });

    render(<LedgerPage />);
    fireEvent.click(screen.getByRole("button", { name: "Model Mix" }));
    expect(document.querySelectorAll('[data-ledger-kpi-badge="zero"]').length).toBeGreaterThan(0);
  });
});
