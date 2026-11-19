/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  useEvalHistory: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  useEvalHistory: apiMock.useEvalHistory,
}));

vi.mock("recharts", () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
  Line: ({ name }: { name?: string }) => <div data-testid={`line-${name}`}>{name}</div>,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { KpiTimelinePanel } from "../kpi-timeline-panel";

describe("KpiTimelinePanel batch22", () => {
  it("renders L3 placeholder line when all scorers are unavailable", () => {
    apiMock.useEvalHistory.mockReturnValue({
      data: {
        runs: [
          {
            id: "run-l3-na",
            traceId: "trace-l3",
            agentId: "agent-a",
            role: "default",
            compositeW: 0.5,
            trusted: true,
            completedAt: "2026-06-15T12:00:00.000Z",
            layers: {
              l1: { score: 0.9, scorers: [] },
              l2: { score: 0.8, scorers: [] },
              l3: { score: 0.1, scorers: [{ metadata: { unavailable: true } }] },
            },
            scorerResults: [],
            judge: {},
            driftGuard: { status: "passed" },
          },
        ],
        timestamp: "2026-06-20T00:00:00.000Z",
      },
      isLoading: false,
      error: null,
    });

    render(<KpiTimelinePanel />);
    expect(screen.getByTestId("line-L3 (N/A — unavailable)")).toBeInTheDocument();
  });
});
