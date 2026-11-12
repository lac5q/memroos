/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ useEvalHistory: vi.fn() }));

vi.mock("@/lib/api-client", () => ({ useEvalHistory: apiMock.useEvalHistory }));

vi.mock("recharts", () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart-b33b">{children}</div>,
  Line: ({ name }: { name?: string }) => <div data-testid={`line-b33b-${name}`}>{name}</div>,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { KpiTimelinePanel } from "../kpi-timeline-panel";

describe("KpiTimelinePanel batch33b", () => {
  it("renders unavailable L3 stub line in chart legend (line 341)", () => {
    const runId = `run-b33b-${randomUUID().slice(0, 8)}`;
    apiMock.useEvalHistory.mockReturnValue({
      data: {
        runs: [
          {
            id: runId,
            traceId: "trace-b33b",
            agentId: "agent-b33b",
            role: "default",
            compositeW: 0.52,
            trusted: true,
            completedAt: "2026-06-20T12:00:00.000Z",
            layers: {
              l1: { score: 0.7, scorers: [] },
              l2: { score: 0.65, scorers: [] },
              l3: {
                score: 0.5,
                scorers: [{ metadata: { unavailable: true, source: "judge-b33b" } }],
              },
            },
            scorerResults: [],
            judge: {},
            driftGuard: { status: "passed" },
          },
        ],
        timestamp: "2026-06-21T00:00:00.000Z",
      },
      isLoading: false,
      error: null,
    });

    render(<KpiTimelinePanel agentId="agent-b33b" />);
    expect(screen.getByTestId("line-b33b-L3 (N/A — unavailable)")).toBeInTheDocument();
  });
});
