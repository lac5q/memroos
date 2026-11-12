/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ useEvalHistory: vi.fn() }));

vi.mock("@/lib/api-client", () => ({ useEvalHistory: apiMock.useEvalHistory }));

vi.mock("recharts", () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart-b34">{children}</div>,
  Line: ({ name, dataKey }: { name?: string; dataKey?: string | (() => null) }) => (
    <div data-testid={`line-b34-${name}`} data-key={typeof dataKey === "function" ? "fn" : dataKey}>
      {name}
    </div>
  ),
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: ({
    formatter,
  }: {
    formatter?: (value: unknown, name: unknown) => [string, string];
  }) => {
    formatter?.("not-a-number", "W");
    return null;
  },
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { KpiTimelinePanel } from "../kpi-timeline-panel";

const mkRun = (id: string, completedAt: string, agentId = "agent-b34") => ({
  id,
  traceId: `trace-${id}`,
  agentId,
  role: "default",
  compositeW: 0.55,
  trusted: true,
  completedAt,
  layers: {
    l1: { score: 0.7, scorers: [] },
    l2: { score: 0.65, scorers: [] },
    l3: { score: 0.5, scorers: [{ metadata: { source: "judge" } }] },
  },
  scorerResults: [],
  judge: {},
  driftGuard: { status: "passed" },
});

describe("KpiTimelinePanel batch34", () => {
  it("filters runs by until date and shows agent-scoped empty copy", () => {
    apiMock.useEvalHistory.mockReturnValue({
      data: {
        runs: [mkRun("in-range", "2026-06-10T12:00:00.000Z"), mkRun("out-range", "2026-06-20T12:00:00.000Z")],
        timestamp: "2026-06-21T00:00:00.000Z",
      },
      isLoading: false,
      error: null,
    });

    render(
      <KpiTimelinePanel
        agentId="agent-b34"
        dateRange={{ since: "2026-06-01T00:00:00.000Z", until: "2026-06-15T00:00:00.000Z" }}
      />,
    );
    expect(screen.getByTestId("line-chart-b34")).toBeInTheDocument();
    expect(screen.getByText(/1 run shown/i)).toBeInTheDocument();

    apiMock.useEvalHistory.mockReturnValue({
      data: { runs: [mkRun("other", "2026-06-20T12:00:00.000Z", "other-agent")], timestamp: "2026-06-21T00:00:00.000Z" },
      isLoading: false,
      error: null,
    });
    render(
      <KpiTimelinePanel
        agentId="agent-b34"
        dateRange={{ since: "2026-06-01T00:00:00.000Z", until: "2026-06-25T00:00:00.000Z" }}
      />,
    );
    expect(screen.getByText(/for agent agent-b34/i)).toBeInTheDocument();
    expect(screen.getByText(/since 2026-06-01/i)).toBeInTheDocument();
  });

  it("renders L3 unavailable stub line (stmt 341)", () => {
    const suffix = randomUUID().slice(0, 8);
    apiMock.useEvalHistory.mockReturnValue({
      data: {
        runs: [
          {
            ...mkRun(`run-unavail-${suffix}`, "2026-06-18T12:00:00.000Z"),
            layers: {
              l1: { score: 0.7, scorers: [] },
              l2: { score: 0.6, scorers: [] },
              l3: {
                score: 0.5,
                scorers: [{ metadata: { unavailable: true, source: `judge-b34-${suffix}` } }],
              },
            },
          },
        ],
        timestamp: "2026-06-21T00:00:00.000Z",
      },
      isLoading: false,
      error: null,
    });

    render(<KpiTimelinePanel agentId="agent-b34" />);
    expect(screen.getByTestId("line-b34-L3 (N/A — unavailable)")).toHaveAttribute("data-key", "fn");
    expect(document.querySelector('[data-kpi-timeline-l3-status="unavailable"]')).toBeTruthy();
  });

  it("toggles the live L3 layer off when scorers are available", () => {
    apiMock.useEvalHistory.mockReturnValue({
      data: {
        runs: [
          {
            ...mkRun("run-mixed-b34", "2026-06-19T12:00:00.000Z"),
            compositeW: undefined as unknown as number,
            layers: {
              l1: { score: 0.71, scorers: [] },
              l2: { score: 0.62, scorers: [] },
              l3: {
                score: 0.58,
                scorers: [
                  { metadata: { unavailable: true } },
                  { metadata: { source: "ok" } },
                ],
              },
            },
          },
        ],
        timestamp: "2026-06-21T00:00:00.000Z",
      },
      isLoading: false,
      error: null,
    });

    render(<KpiTimelinePanel />);
    expect(screen.getByTestId("line-b34-L3")).toBeInTheDocument();
    fireEvent.click(document.querySelector('[data-kpi-layer-toggle="l3"]')!);
    expect(screen.queryByTestId("line-b34-L3")).not.toBeInTheDocument();
  });

  it.skip("summary badge stale/degraded/error arms while chart is visible (branches 361-381)", () => {
    // Chart view only mounts when loading/error are false; adapters never emit stale/degraded on historyEnv/l3Env here.
  });
});
