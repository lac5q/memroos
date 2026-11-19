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
    <div data-testid="heatmap-grid" data-cells={JSON.stringify(data)} />
  ),
}));

describe("ActivityHeatmap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T15:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders live heatmap cells for 24h bucket writes and agent messages", () => {
    api.useOperationsNoc.mockReturnValue({
      data: {
        agentActivity: {
          sourceState: "live",
          agents: [
            {
              lastMessageAt: "2026-07-20T14:00:00.000Z",
              messageCount: 3,
            },
          ],
        },
        sourceStates: { agentActivity: "live" },
      },
      isLoading: false,
      isError: false,
    });
    api.useTimeSeries.mockReturnValue({
      data: {
        points: [{ bucket: "14:00", value: 2 }],
      },
      isLoading: false,
      isError: false,
    });

    render(<ActivityHeatmap filters={{ window: "24h", workspace: "all" }} />);

    expect(screen.getByTestId("heatmap-grid")).toBeInTheDocument();
    expect(screen.getByText(/3 messages/i)).toBeInTheDocument();
    expect(screen.getByText(/2 memory writes/i)).toBeInTheDocument();
  });

  it("uses window_empty copy when the source reports an empty window", () => {
    api.useOperationsNoc.mockReturnValue({
      data: {
        agentActivity: { sourceState: "window_empty", agents: [] },
        sourceStates: { agentActivity: "window_empty" },
      },
      isLoading: false,
      isError: false,
    });
    api.useTimeSeries.mockReturnValue({ data: { points: [] }, isLoading: false, isError: false });

    render(<ActivityHeatmap filters={{ window: "7d", workspace: "all" }} />);
    expect(screen.getByText(/Nothing in .* for workspace=all/i)).toBeInTheDocument();
  });

  it("shows stale_or_error when noc or writes fail", () => {
    api.useOperationsNoc.mockReturnValue({
      data: {
        agentActivity: { sourceState: "stale_or_error", agents: [] },
        sourceStates: { agentActivity: "stale_or_error" },
      },
      isLoading: false,
      isError: true,
    });
    api.useTimeSeries.mockReturnValue({ data: undefined, isLoading: false, isError: true });

    render(<ActivityHeatmap filters={{ window: "24h", workspace: "all" }} />);
    expect(document.querySelector('[data-status-block="stale_or_error"]')).toBeTruthy();
    expect(screen.getByText(/stale or unavailable/i)).toBeInTheDocument();
  });

  it("maps 7d bucket strings into timed activity for the heatmap", () => {
    api.useOperationsNoc.mockReturnValue({
      data: {
        agentActivity: { sourceState: "live", agents: [] },
        sourceStates: { agentActivity: "live" },
      },
      isLoading: false,
      isError: false,
    });
    api.useTimeSeries.mockReturnValue({
      data: { points: [{ bucket: "2026-07-18", value: 4 }] },
      isLoading: false,
      isError: false,
    });

    render(<ActivityHeatmap filters={{ window: "7d", workspace: "all" }} />);
    expect(screen.getByTestId("heatmap-grid")).toBeInTheDocument();
  });
});
