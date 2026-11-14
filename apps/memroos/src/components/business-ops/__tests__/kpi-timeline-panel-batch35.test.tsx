/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ useEvalHistory: vi.fn() }));

vi.mock("@/lib/api-client", () => ({ useEvalHistory: apiMock.useEvalHistory }));

vi.mock("recharts", () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart-b35">{children}</div>,
  Line: ({ name }: { name?: string }) => <div data-testid={`line-b35-${name}`} />,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { KpiTimelinePanel } from "../kpi-timeline-panel";

const mkRun = (id: string, completedAt: string) => ({
  id,
  traceId: `trace-${id}`,
  agentId: "agent-b35",
  role: "default",
  compositeW: 0.51,
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

describe("KpiTimelinePanel batch35", () => {
  it("filters out runs before since boundary", () => {
    apiMock.useEvalHistory.mockReturnValue({
      data: {
        runs: [
          mkRun("in-b35", "2026-06-12T12:00:00.000Z"),
          mkRun("out-b35", "2026-05-28T12:00:00.000Z"),
        ],
        timestamp: "2026-06-15T00:00:00.000Z",
      },
      isLoading: false,
      error: null,
    });
    render(
      <KpiTimelinePanel
        agentId="agent-b35"
        dateRange={{ since: "2026-06-01T00:00:00.000Z", until: "2026-06-20T00:00:00.000Z" }}
      />,
    );
    expect(screen.getByText(/1 run shown/i)).toBeInTheDocument();
  });

  it("shows loading copy while history is fetching", () => {
    apiMock.useEvalHistory.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });
    render(<KpiTimelinePanel agentId={`agent-${randomUUID().slice(0, 6)}`} />);
    expect(screen.getByText(/Loading timeline/i)).toBeInTheDocument();
  });

  it.skip("summary badge stale/degraded arms (branches 361-381)", () => {
    // Adapters only return live/error envelopes in chart view; stale/degraded summary arms stay sticky.
  });
});
