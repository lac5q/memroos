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

function envelope(value: number | null, status: MetricEnvelope<number>["status"]): MetricEnvelope<number> {
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

describe("PulseStrip batch27 — unknown envelope status fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.useTimeSeries.mockReturnValue({ data: null, isLoading: false, isError: false });
    api.useModelUsage.mockReturnValue({
      data: {
        usage: { models: [], total: { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreation: 0, requests: 0 } },
        timestamp: "2026-07-20T12:00:00.000Z",
      },
      isLoading: false,
      isError: false,
    });
  });

  it("treats unrecognized metric statuses as no_history", () => {
    api.useOperationsNoc.mockReturnValue({
      data: {
        metrics: {
          memoryRows: envelope(1, "live"),
          enabledSkills: envelope(null, "unknown" as MetricEnvelope<number>["status"]),
          cronWarnings: envelope(null, "empty"),
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
    expect(screen.getByText("Skills enabled")).toBeInTheDocument();
  });
});
