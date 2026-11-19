import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MetricEnvelope } from "@/lib/metric-status";
import { PulseStrip } from "../pulse-strip";

const api = vi.hoisted(() => ({
  useOperationsNoc: vi.fn(),
  useModelUsage: vi.fn(),
  useTimeSeries: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  useOperationsNoc: api.useOperationsNoc,
  useModelUsage: api.useModelUsage,
  useTimeSeries: api.useTimeSeries,
}));

function envelope(
  status: MetricEnvelope<number>["status"],
  value: number | null = null,
): MetricEnvelope<number> {
  return {
    value,
    status,
    source: "sqlite://test",
    observedAt: null,
    freshnessMs: null,
    scope: { window: "24h", workspace: "all" },
    reason: null,
  };
}

describe("PulseStrip batch22", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.useTimeSeries.mockReturnValue({
      data: { points: [{ bucket: "12:00", value: 1 }], metric: "memory_writes", window: "day", timestamp: "2026-07-20T12:00:00.000Z" },
      isLoading: false,
      isError: true,
    });
    api.useModelUsage.mockReturnValue({
      data: {
        usage: { models: [], total: { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreation: 0, requests: 0 } },
        timestamp: "2026-07-20T12:00:00.000Z",
      },
      isLoading: false,
      isError: false,
    });
  });

  it("maps degraded cron envelopes and time-series errors to stale semantics", () => {
    api.useOperationsNoc.mockReturnValue({
      data: {
        metrics: {
          memoryRows: envelope("live", 3),
          enabledSkills: envelope("blocked", null),
          cronWarnings: envelope("empty", null),
        },
        agentActivity: {
          sourceState: "live",
          source: "sqlite://messages",
          observedAt: "2026-07-20T12:00:00.000Z",
          agents: [],
          delegations: [],
        },
        sourceStates: { agentActivity: "live", efficiencySignals: "known_unwired" },
      },
      isLoading: false,
      isError: false,
    });

    render(<PulseStrip filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByText("Cron health")).toBeInTheDocument();
    expect(screen.getByText("clear")).toBeInTheDocument();
    expect(screen.getByText(/Memory-write timing is stale or unavailable/i)).toBeInTheDocument();
  });
});
