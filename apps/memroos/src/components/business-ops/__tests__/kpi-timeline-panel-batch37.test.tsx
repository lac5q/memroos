/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { randomUUID } from "node:crypto";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ useEvalHistory: vi.fn() }));

vi.mock("@/lib/api-client", () => ({ useEvalHistory: apiMock.useEvalHistory }));

vi.mock("recharts", () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart-b37">{children}</div>,
  Line: ({
    name,
    dataKey,
  }: {
    name?: string;
    dataKey?: string | (() => null);
  }) => {
    if (typeof dataKey === "function") {
      expect(dataKey()).toBeNull();
    }
    return (
      <div data-testid={`line-b37-${name}`} data-key={typeof dataKey === "function" ? "fn" : dataKey}>
        {name}
      </div>
    );
  },
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: ({
    formatter,
  }: {
    formatter?: (value: unknown, name: unknown) => [string, string];
  }) => {
    expect(formatter?.("not-a-number", "W")).toEqual(["—", "W"]);
    return null;
  },
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { KpiTimelinePanel } from "../kpi-timeline-panel";

const mkRun = (id: string) => ({
  id,
  traceId: `trace-${id}`,
  agentId: "agent-b37",
  role: "default",
  compositeW: 0.62,
  trusted: true,
  completedAt: "2026-06-18T12:00:00.000Z",
  layers: {
    l1: { score: 0.7, scorers: [] },
    l2: { score: 0.65, scorers: [] },
    l3: {
      score: null,
      scorers: [{ metadata: { unavailable: true, source: "judge-b37" } }],
    },
  },
  scorerResults: [],
  judge: {},
  driftGuard: { status: "passed" },
});

describe("KpiTimelinePanel batch37", () => {
  it("invokes the L3 unavailable dataKey stub (line 341) and styles l3 summary badge", () => {
    apiMock.useEvalHistory.mockReturnValue({
      data: {
        runs: [mkRun(`run-b37-${randomUUID().slice(0, 6)}`)],
        timestamp: "2026-06-21T00:00:00.000Z",
      },
      isLoading: false,
      error: null,
    });

    render(<KpiTimelinePanel agentId="agent-b37" />);
    expect(screen.getByTestId("line-b37-L3 (N/A — unavailable)")).toHaveAttribute("data-key", "fn");
    const l3Badge = document.querySelector('[data-kpi-timeline-l3-status="unavailable"]');
    expect(l3Badge).toBeTruthy();
    expect(l3Badge).toHaveTextContent(/l3:/i);
  });

  it.skip("history summary badge empty/error arms (360-365) — chart body only renders when historyEnv.status is live", () => {});
  it.skip("l3 summary badge empty/error arms (376-377, 381) — l3Env cannot be empty/error while points.length > 0", () => {});
});