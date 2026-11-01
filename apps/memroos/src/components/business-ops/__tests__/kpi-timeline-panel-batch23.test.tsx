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

const run = {
  id: "run-batch23",
  traceId: "trace-batch23",
  agentId: "agent-batch23",
  role: "default",
  compositeW: 0.61,
  trusted: true,
  completedAt: "2026-06-15T12:00:00.000Z",
  layers: {
    l1: { score: 0.7, scorers: [] },
    l2: { score: 0.6, scorers: [] },
    l3: { score: 0.5, scorers: [{ metadata: { unavailable: true } }] },
  },
  scorerResults: [],
  judge: {},
  driftGuard: { status: "passed" },
};

describe("KpiTimelinePanel batch23", () => {
  it("toggles layer lines and keeps L3 placeholder when unavailable", () => {
    apiMock.useEvalHistory.mockReturnValue({
      data: { runs: [run], timestamp: "2026-06-20T00:00:00.000Z" },
      isLoading: false,
      error: null,
    });

    render(<KpiTimelinePanel />);
    expect(screen.getByTestId("line-L3 (N/A — unavailable)")).toBeInTheDocument();

    fireEvent.click(document.querySelector('[data-kpi-layer-toggle="l1"]')!);
    fireEvent.click(document.querySelector('[data-kpi-layer-toggle="l2"]')!);
    expect(screen.queryByTestId("line-L1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("line-L2")).not.toBeInTheDocument();
  });
});
