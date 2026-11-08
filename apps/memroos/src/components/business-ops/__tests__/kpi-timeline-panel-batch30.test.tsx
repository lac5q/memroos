/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ useEvalHistory: vi.fn() }));

vi.mock("@/lib/api-client", () => ({ useEvalHistory: apiMock.useEvalHistory }));

vi.mock("recharts", () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart-b30">{children}</div>,
  Line: ({ name, dataKey }: { name?: string; dataKey?: string | (() => null) }) => (
    <div data-testid={`line-b30-${name ?? String(dataKey)}`}>{name}</div>
  ),
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { KpiTimelinePanel } from "../kpi-timeline-panel";

describe("KpiTimelinePanel batch30", () => {
  it("renders L3 unavailable legend line when every scorer is unavailable (line 341)", () => {
    const runId = `run-b30-${randomUUID().slice(0, 8)}`;
    apiMock.useEvalHistory.mockReturnValue({
      data: {
        runs: [
          {
            id: runId,
            traceId: "trace-b30",
            agentId: "agent-b30",
            role: "default",
            compositeW: 0.62,
            trusted: true,
            completedAt: "2026-06-20T12:00:00.000Z",
            layers: {
              l1: { score: 0.7, scorers: [] },
              l2: { score: 0.65, scorers: [] },
              l3: {
                score: 0.5,
                scorers: [{ metadata: { unavailable: true, source: "judge-b30" } }],
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

    render(<KpiTimelinePanel agentId="agent-b30" />);
    expect(screen.getByTestId("line-b30-L3 (N/A — unavailable)")).toBeInTheDocument();
    expect(document.querySelector('[data-kpi-timeline-l3-status="unavailable"]')).toBeTruthy();
    fireEvent.click(document.querySelector('[data-kpi-layer-toggle="l3"]')!);
    expect(screen.queryByTestId("line-b30-L3 (N/A — unavailable)")).not.toBeInTheDocument();
  });
});
