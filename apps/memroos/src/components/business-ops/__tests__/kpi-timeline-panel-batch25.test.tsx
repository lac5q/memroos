/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ useEvalHistory: vi.fn() }));

vi.mock("@/lib/api-client", () => ({ useEvalHistory: apiMock.useEvalHistory }));

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

const baseRun = {
  id: "run-batch25",
  traceId: "trace-batch25",
  agentId: "agent-batch25",
  role: "default",
  compositeW: 0.66,
  trusted: true,
  completedAt: "2026-06-15T12:00:00.000Z",
  layers: {
    l1: { score: 0.71, scorers: [] },
    l2: { score: 0.62, scorers: [] },
    l3: { score: 0.58, scorers: [{ metadata: { source: "judge" } }] },
  },
  scorerResults: [],
  judge: {},
  driftGuard: { status: "passed" },
};

describe("KpiTimelinePanel batch25", () => {
  it("renders loading and error envelopes", () => {
    apiMock.useEvalHistory.mockReturnValueOnce({
      data: undefined,
      isLoading: true,
      error: null,
    });
    const { rerender } = render(<KpiTimelinePanel />);
    expect(document.querySelector("[data-kpi-timeline-loading]")).toHaveTextContent(/Loading timeline/i);

    apiMock.useEvalHistory.mockReturnValueOnce({
      data: undefined,
      isLoading: false,
      error: new Error("batch25 history down"),
    });
    rerender(<KpiTimelinePanel />);
    expect(document.querySelector("[data-kpi-timeline-error]")).toHaveTextContent(/batch25 history down/i);
  });

  it("filters empty runs by agent and date range", () => {
    apiMock.useEvalHistory.mockReturnValue({
      data: {
        runs: [
          { ...baseRun, id: "other-agent", agentId: "other", completedAt: "2026-05-01T12:00:00.000Z" },
        ],
        timestamp: "2026-06-20T00:00:00.000Z",
      },
      isLoading: false,
      error: null,
    });

    render(
      <KpiTimelinePanel
        agentId="agent-batch25"
        dateRange={{ since: "2026-06-01T00:00:00.000Z", until: "2026-06-30T00:00:00.000Z" }}
      />,
    );

    expect(document.querySelector('[data-kpi-timeline-empty="true"]')).toBeTruthy();
    expect(document.querySelector("[data-kpi-timeline-empty-message]")).toHaveTextContent(/agent-batch25/i);
    expect(document.querySelector("[data-kpi-timeline-empty-message]")).toHaveTextContent(/since 2026-06-01/i);
  });

  it("renders chart summary badges and hides L3 when toggled off", () => {
    apiMock.useEvalHistory.mockReturnValue({
      data: { runs: [baseRun], timestamp: "2026-06-20T00:00:00.000Z" },
      isLoading: false,
      error: null,
    });

    render(<KpiTimelinePanel agentId="agent-batch25" />);
    expect(screen.getByTestId("line-L3")).toBeInTheDocument();
    expect(document.querySelector('[data-kpi-timeline-runs-status="live"]')).toBeTruthy();

    fireEvent.click(document.querySelector('[data-kpi-layer-toggle="l3"]')!);
    expect(screen.queryByTestId("line-L3")).not.toBeInTheDocument();
    expect(document.querySelector("[data-kpi-timeline-scope]")).toHaveAttribute(
      "data-kpi-timeline-scope",
      "agentId=agent-batch25, since=all",
    );
  });
});
