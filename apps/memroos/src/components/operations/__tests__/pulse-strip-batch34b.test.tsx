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
  reason: string | null = null,
): MetricEnvelope<number> {
  return {
    value,
    status,
    source: "sqlite://test",
    observedAt: "2026-07-20T12:00:00.000Z",
    freshnessMs: null,
    scope: { window: "24h", workspace: "all" },
    reason,
  };
}

describe("PulseStrip batch34b — compact numbers and status branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.useModelUsage.mockReturnValue({
      data: {
        usage: {
          models: [{ name: "gpt", requests: 2, totalTokens: 10, inputTokens: 5, outputTokens: 5, cacheRead: 0, cacheCreation: 0 }],
          total: { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreation: 0, requests: 0 },
        },
        timestamp: "2026-07-20T12:00:00.000Z",
      },
      isLoading: false,
      isError: false,
    });
    api.useTimeSeries.mockReturnValue({
      data: { points: [{ bucket: "12:00", value: 1500 }], metric: "memory_writes", window: "day", timestamp: "2026-07-20T12:00:00.000Z" },
      isLoading: false,
      isError: false,
    });
    api.useOperationsNoc.mockReturnValue({
      data: {
        metrics: {
          memoryRows: envelope("live", 2500),
          enabledSkills: envelope("live", 3),
          cronWarnings: envelope("live", 2, "stale jobs"),
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
  });

  it("renders compact notation for large counts (lines 35–36, 163)", () => {
    render(<PulseStrip filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByText("2.5K")).toBeInTheDocument();
    expect(screen.getByText("1.5K")).toBeInTheDocument();
  });

  it("pluralizes cron warning copy (lines 265, 272–273)", () => {
    render(<PulseStrip filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByText("2 warnings")).toBeInTheDocument();
    expect(screen.getByText(/Active cron jobs need operator attention/i)).toBeInTheDocument();
  });

  it("shows model usage error detail (lines 297, 311)", () => {
    api.useModelUsage.mockReturnValue({
      data: null,
      isLoading: false,
      isError: true,
    });
    render(<PulseStrip filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByText(/Model usage is stale or unavailable/i)).toBeInTheDocument();
  });

  it("uses warn color for degraded card status (line 367)", () => {
    api.useOperationsNoc.mockReturnValue({
      data: {
        metrics: {
          memoryRows: envelope("degraded", null, "partial"),
          enabledSkills: envelope("live", 1),
          cronWarnings: envelope("empty", 0),
        },
        agentActivity: {
          sourceState: "stale_or_error",
          source: "sqlite://messages",
          observedAt: null,
          agents: [],
          delegations: [],
        },
        sourceStates: { agentActivity: "stale_or_error", efficiencySignals: "known_unwired" },
      },
      isLoading: false,
      isError: false,
    });
    const { container } = render(<PulseStrip filters={{ window: "24h", workspace: "workspace-a" }} />);
    const statusBlocks = container.querySelectorAll("[data-status-block]");
    expect(statusBlocks.length).toBeGreaterThan(0);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
