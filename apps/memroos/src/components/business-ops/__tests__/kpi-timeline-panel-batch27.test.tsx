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
    formatter?.(0.81234, "W");
    formatter?.("not-a-number", "L3");
    return null;
  },
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { KpiTimelinePanel } from "../kpi-timeline-panel";

const sparseLayersRun = {
  id: "run-batch27-sparse",
  traceId: "trace-batch27-sparse",
  agentId: "agent-batch27",
  role: "default",
  compositeW: 0.55,
  trusted: true,
  completedAt: "2026-06-20T12:00:00.000Z",
  layers: {
    l3: { score: 0.44, scorers: [{ metadata: { source: "judge-batch27" } }] },
  },
  scorerResults: [],
  judge: {},
  driftGuard: { status: "passed" },
};

describe("KpiTimelinePanel batch27", () => {
  it("defaults missing L1/L2 scores to zero and formats tooltip values", () => {
    apiMock.useEvalHistory.mockReturnValue({
      data: { runs: [sparseLayersRun], timestamp: "2026-06-21T00:00:00.000Z" },
      isLoading: false,
      error: null,
    });

    render(<KpiTimelinePanel agentId="agent-batch27" />);
    expect(screen.getByTestId("line-W")).toBeInTheDocument();
    expect(screen.getByTestId("line-L1")).toBeInTheDocument();
    expect(screen.getByTestId("line-L2")).toBeInTheDocument();
    expect(document.querySelector('[data-kpi-timeline-l3-status="live"]')).toBeTruthy();
  });

  it("filters runs by until date and shows composite W summary", () => {
    apiMock.useEvalHistory.mockReturnValue({
      data: {
        runs: [
          sparseLayersRun,
          {
            ...sparseLayersRun,
            id: "run-batch27-old",
            completedAt: "2026-05-01T12:00:00.000Z",
            compositeW: 0.11,
          },
        ],
        timestamp: "2026-06-21T00:00:00.000Z",
      },
      isLoading: false,
      error: null,
    });

    render(
      <KpiTimelinePanel
        dateRange={{ until: "2026-06-15T00:00:00.000Z" }}
      />,
    );

    expect(screen.getByText(/1 run shown/i)).toBeInTheDocument();
    expect(document.querySelector('[data-kpi-timeline-w-status="live"]')).toBeTruthy();
    fireEvent.click(document.querySelector('[data-kpi-layer-toggle="l1"]')!);
    expect(screen.queryByTestId("line-L1")).not.toBeInTheDocument();
  });
});
