/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ useEvalHistory: vi.fn() }));

vi.mock("@/lib/api-client", () => ({ useEvalHistory: apiMock.useEvalHistory }));

vi.mock("recharts", () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart-b32">{children}</div>,
  Line: ({ name, dataKey }: { name?: string; dataKey?: string | (() => null) }) => (
    <div data-testid={`line-b32-${name ?? String(dataKey)}`}>{name}</div>
  ),
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { KpiTimelinePanel } from "../kpi-timeline-panel";

describe("KpiTimelinePanel batch32", () => {
  it("renders unavailable L3 legend stub (line 341)", () => {
    const runId = `run-b32-${randomUUID().slice(0, 8)}`;
    apiMock.useEvalHistory.mockReturnValue({
      data: {
        runs: [
          {
            id: runId,
            traceId: "trace-b32",
            agentId: "agent-b32",
            role: "default",
            compositeW: 0.55,
            trusted: true,
            completedAt: "2026-06-20T12:00:00.000Z",
            layers: {
              l1: { score: 0.7, scorers: [] },
              l2: { score: 0.65, scorers: [] },
              l3: {
                score: 0.5,
                scorers: [{ metadata: { unavailable: true, source: "judge-b32" } }],
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

    render(<KpiTimelinePanel agentId="agent-b32" />);
    expect(screen.getByTestId("line-b32-L3 (N/A — unavailable)")).toBeInTheDocument();
    fireEvent.click(document.querySelector('[data-kpi-layer-toggle="l3"]')!);
    expect(screen.queryByTestId("line-b32-L3 (N/A — unavailable)")).not.toBeInTheDocument();
  });
});
