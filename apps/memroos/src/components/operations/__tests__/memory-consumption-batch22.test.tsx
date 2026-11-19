import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryConsumption } from "../memory-consumption";

const api = vi.hoisted(() => ({
  useMemoryStats: vi.fn(),
  useMemoryTierHealth: vi.fn(),
  useTimeSeries: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  useMemoryStats: api.useMemoryStats,
  useMemoryTierHealth: api.useMemoryTierHealth,
  useTimeSeries: api.useTimeSeries,
}));

describe("MemoryConsumption batch22", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.useMemoryTierHealth.mockReturnValue({
      data: { tiers: [], timestamp: "2026-07-13T12:00:00Z" },
      isLoading: false,
      isError: false,
    });
    api.useTimeSeries.mockReturnValue({
      data: { points: [], metric: "memory_writes", window: "24h", timestamp: "2026-07-13T12:00:00Z" },
      isLoading: false,
      isError: true,
    });
  });

  it("classifies consolidation failures and tier inventory errors", () => {
    api.useMemoryStats.mockReturnValue({
      data: {
        lastRun: { status: "failed", batch_size: 0, started_at: "2026-07-13T11:00:00Z", error_message: "batch22 fail" },
        pendingUnconsolidated: 2,
        tierStats: [{ tier: "high", count: 1 }],
        sources: [],
        recentFailures24h: 1,
        timestamp: "2026-07-13T12:00:00Z",
      },
      isLoading: false,
      isError: false,
    });

    render(<MemoryConsumption filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getAllByText(/batch22 fail/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Pending consolidation")).toBeInTheDocument();
  });

  it("shows blocked tier inventory while memory stats are loading", () => {
    api.useMemoryStats.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    render(<MemoryConsumption filters={{ window: "24h", workspace: "local" }} />);
    expect(screen.getByText("Tier rows")).toBeInTheDocument();
  });
});
