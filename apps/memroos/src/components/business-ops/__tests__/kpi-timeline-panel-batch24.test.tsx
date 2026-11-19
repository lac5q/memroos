/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
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

describe("KpiTimelinePanel batch24", () => {
  it("renders available L3 line when scorer metadata is present", () => {
    apiMock.useEvalHistory.mockReturnValue({
      data: {
        runs: [
          {
            id: "run-batch24",
            traceId: "trace-batch24",
            agentId: "agent-batch24",
            role: "default",
            compositeW: 0.71,
            trusted: true,
            completedAt: "2026-06-15T12:00:00.000Z",
            layers: {
              l1: { score: 0.7, scorers: [] },
              l2: { score: 0.6, scorers: [] },
              l3: { score: 0.55, scorers: [{ metadata: { source: "judge" } }] },
            },
            scorerResults: [],
            judge: {},
            driftGuard: { status: "passed" },
          },
        ],
        timestamp: "2026-06-20T00:00:00.000Z",
      },
      isLoading: false,
      error: null,
    });

    render(<KpiTimelinePanel />);
    expect(screen.getByTestId("line-L3")).toBeInTheDocument();
  });
});
