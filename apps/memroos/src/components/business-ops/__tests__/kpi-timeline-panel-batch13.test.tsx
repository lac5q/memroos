import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  useEvalHistory: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  useEvalHistory: apiMock.useEvalHistory,
}));

vi.mock("recharts", () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: ({ formatter }: { formatter?: (value: unknown, name: unknown) => [string, string] }) => (
    <div data-testid="tooltip-formatter">
      {formatter?.("not-a-number", "W")?.join(":")}
    </div>
  ),
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { KpiTimelinePanel } from "../kpi-timeline-panel";

const baseRun = {
  id: "run-1",
  traceId: "trace-1",
  agentId: "agent-a",
  role: "default",
  compositeW: 0.82,
  trusted: true,
  completedAt: "2026-06-15T12:00:00.000Z",
  layers: {
    l1: { score: 0.9, scorers: [] },
    l2: { score: 0.85, scorers: [] },
    l3: { score: 0.7, scorers: [{ metadata: {} }] },
  },
  scorerResults: [],
  judge: {},
  driftGuard: { status: "passed" },
};

describe("KpiTimelinePanel batch13 coverage", () => {
  it("renders API error detail", () => {
    apiMock.useEvalHistory.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("history timeout"),
    });

    render(<KpiTimelinePanel />);
    expect(document.querySelector("[data-kpi-timeline-error]")).toBeTruthy();
    expect(screen.getByText(/history timeout/i)).toBeInTheDocument();
  });

  it("filters runs by agent, since, and until", () => {
    apiMock.useEvalHistory.mockReturnValue({
      data: {
        runs: [
          baseRun,
          {
            ...baseRun,
            id: "run-old",
            agentId: "agent-b",
            completedAt: "2026-05-01T12:00:00.000Z",
          },
          {
            ...baseRun,
            id: "run-future",
            completedAt: "2026-07-01T12:00:00.000Z",
          },
        ],
        timestamp: "2026-06-20T00:00:00.000Z",
      },
      isLoading: false,
      error: null,
    });

    render(
      <KpiTimelinePanel
        agentId="agent-a"
        dateRange={{ since: "2026-06-01T00:00:00.000Z", until: "2026-06-30T00:00:00.000Z" }}
      />,
    );

    expect(document.querySelector("[data-kpi-timeline-scope]")).toHaveAttribute(
      "data-kpi-timeline-scope",
      expect.stringContaining("agent-a"),
    );
    expect(document.querySelector("[data-kpi-timeline-runs-status]")).toHaveTextContent("runs: live (1)");
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
  });

  it("toggles L2/L3 layers and formats non-numeric tooltip values", () => {
    apiMock.useEvalHistory.mockReturnValue({
      data: { runs: [baseRun], timestamp: "2026-06-20T00:00:00.000Z" },
      isLoading: false,
      error: null,
    });

    render(<KpiTimelinePanel dateRange={{ since: "2026-06-01T00:00:00.000Z" }} />);

    const l2Toggle = document.querySelector('[data-kpi-layer-toggle="l2"]') as HTMLInputElement;
    const l3Toggle = document.querySelector('[data-kpi-layer-toggle="l3"]') as HTMLInputElement;
    fireEvent.click(l2Toggle);
    fireEvent.click(l3Toggle);
    expect(l2Toggle.checked).toBe(false);
    expect(l3Toggle.checked).toBe(false);
    expect(screen.getByTestId("tooltip-formatter")).toHaveTextContent("—:W");
  });
});
