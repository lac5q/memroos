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
  Tooltip: ({
    formatter,
  }: {
    formatter?: (value: unknown, name: unknown) => [string, string];
  }) => {
    formatter?.(0.7123, "L1");
    formatter?.("n/a", "L2");
    return null;
  },
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { KpiTimelinePanel } from "../kpi-timeline-panel";

const baseRun = {
  id: "run-batch26",
  traceId: "trace-batch26",
  agentId: "agent-batch26",
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

describe("KpiTimelinePanel batch26", () => {
  it("formats non-Error history failures and toggles L1/L2 layers", () => {
    apiMock.useEvalHistory.mockReturnValueOnce({
      data: undefined,
      isLoading: false,
      error: "batch26 string error",
    });
    const { rerender } = render(<KpiTimelinePanel />);
    expect(document.querySelector("[data-kpi-timeline-error]")).toHaveTextContent(/unknown error/i);

    apiMock.useEvalHistory.mockReturnValue({
      data: { runs: [baseRun, { ...baseRun, id: "run-batch26-b", completedAt: "2026-06-16T12:00:00.000Z" }], timestamp: "2026-06-20T00:00:00.000Z" },
      isLoading: false,
      error: null,
    });
    rerender(<KpiTimelinePanel agentId="agent-batch26" />);

    expect(screen.getByTestId("line-L1")).toBeInTheDocument();
    expect(screen.getByTestId("line-L2")).toBeInTheDocument();
    fireEvent.click(document.querySelector('[data-kpi-layer-toggle="l1"]')!);
    fireEvent.click(document.querySelector('[data-kpi-layer-toggle="l2"]')!);
    expect(screen.queryByTestId("line-L1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("line-L2")).not.toBeInTheDocument();
    expect(screen.getByText(/2 runs shown/i)).toBeInTheDocument();
  });

  it("renders L3 placeholder line when every scorer is unavailable", () => {
    apiMock.useEvalHistory.mockReturnValue({
      data: {
        runs: [
          {
            ...baseRun,
            layers: {
              l1: { score: 0.7, scorers: [] },
              l2: { score: 0.6, scorers: [] },
              l3: {
                score: 0.5,
                scorers: [{ metadata: { unavailable: true } }, { metadata: { unavailable: true } }],
              },
            },
          },
        ],
        timestamp: "2026-06-20T00:00:00.000Z",
      },
      isLoading: false,
      error: null,
    });

    render(<KpiTimelinePanel />);
    expect(screen.getByTestId("line-L3 (N/A — unavailable)")).toBeInTheDocument();
    expect(document.querySelector('[data-kpi-timeline-l3-status="unavailable"]')).toBeTruthy();
    expect(document.querySelector("[data-kpi-timeline-l3-reason]")).toHaveTextContent(/unavailable/i);
    expect(document.querySelector("[data-kpi-timeline-reason]")).toHaveTextContent(/eval runs/i);
  });
});
