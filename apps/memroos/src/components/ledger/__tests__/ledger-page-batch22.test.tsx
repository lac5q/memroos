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

vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams(
      "from_window=24h&from_workspace=local&from_scope_note=batch22+drilldown+note",
    ),
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

function mockLoadedLedger() {
  apiMock.useTokenStats.mockReturnValue({
    data: {
      available: true,
      stats: {
        tokensSaved: 120,
        totalCommands: 4,
        avgExecutionTime: 0.5,
        savingsPercent: 12,
        commandBreakdown: [{ command: "rtk run", count: 2, tokensSaved: 50, savingsPercent: 10 }],
      },
      timestamp: "2026-05-21T00:00:00.000Z",
    },
    isLoading: false,
    error: null,
  });
  apiMock.useModelUsage.mockReturnValue({
    data: {
      usage: {
        models: [{ name: "claude", totalTokens: 100, inputTokens: 60, outputTokens: 40, cacheRead: 0, requests: 1 }],
        total: { inputTokens: 60, outputTokens: 40, cacheRead: 0, cacheCreation: 0, requests: 1 },
      },
      timestamp: "2026-05-21T00:00:00.000Z",
    },
    isLoading: false,
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
    data: { taskType: "engineering", strategy: "balanced", recommendations: [], timestamp: "2026-05-21T00:00:00.000Z" },
    isLoading: false,
    error: null,
  });
  apiMock.useModelRoutingEvals.mockReturnValue({
    data: { dimensions: [], referenceTasks: [], summary: null, timestamp: "2026-05-21T00:00:00.000Z" },
    isLoading: false,
    error: null,
  });
}

describe("LedgerPage batch22", () => {
  it("shows drilldown banner from search params and switches tabs", () => {
    mockLoadedLedger();
    render(<LedgerPage />);
    expect(screen.getByText(/Drilldown from Operations NOC/i)).toBeInTheDocument();
    expect(screen.getByText(/batch22 drilldown note/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Model Mix" }));
    expect(screen.getByText(/Claude JSONL \+ efficiency token_ledger/i)).toBeInTheDocument();
  });
});
