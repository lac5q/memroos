/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActivityHeatmap } from "../activity-heatmap";

const api = vi.hoisted(() => ({
  useOperationsNoc: vi.fn(),
  useTimeSeries: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  useOperationsNoc: api.useOperationsNoc,
  useTimeSeries: api.useTimeSeries,
}));

vi.mock("@/components/shared/charts", () => ({
  Heatmap: ({ data }: { data: number[][] }) => (
    <div data-testid="heatmap-batch32" data-cells={JSON.stringify(data)} />
  ),
}));

describe("ActivityHeatmap batch32", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T15:30:00.000Z"));
    api.useOperationsNoc.mockReturnValue({
      data: {
        agentActivity: { sourceState: "live", agents: [] },
        sourceStates: { agentActivity: "live" },
      },
      isLoading: false,
      isError: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rolls 24h buckets to the previous day when the hour is still ahead of now (lines 61-62)", () => {
    api.useTimeSeries.mockReturnValue({
      data: { points: [{ bucket: "23:00", value: 3 }] },
      isLoading: false,
      isError: false,
    });

    render(<ActivityHeatmap filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByTestId("heatmap-batch32")).toBeInTheDocument();
    expect(screen.getByText(/3 memory writes/i)).toBeInTheDocument();
  });
});
