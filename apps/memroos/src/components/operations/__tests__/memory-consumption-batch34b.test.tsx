/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/api-client", () => ({
  useMemoryStats: vi.fn(),
  useMemoryTierHealth: vi.fn(),
  useTimeSeries: vi.fn(),
}));

import { useMemoryStats, useMemoryTierHealth, useTimeSeries } from "@/lib/api-client";
import { MemoryConsumption } from "../memory-consumption";

const mockMemory = vi.mocked(useMemoryStats);
const mockHealth = vi.mocked(useMemoryTierHealth);
const mockSeries = vi.mocked(useTimeSeries);

function seriesOk(points: Array<{ bucket: string; value: number }> = []) {
  return { isLoading: false, isError: false, data: { points } } as ReturnType<typeof useTimeSeries>;
}

function memoryOk(overrides: Record<string, unknown> = {}) {
  return {
    isLoading: false,
    isError: false,
    data: {
      tierStats: [
        { tier: "high", count: 1200 },
        { tier: "low", count: 50 },
        { tier: "pinned", count: 3 },
      ],
      sources: [{ id: "sqlite" }],
      pendingUnconsolidated: 2,
      lastRun: { status: "completed", error_message: null },
      ...overrides,
    },
  } as ReturnType<typeof useMemoryStats>;
}

function bindMemoryMocks(primary: ReturnType<typeof useMemoryStats>, history?: ReturnType<typeof useMemoryStats>) {
  mockMemory.mockImplementation((args: { window?: string; workspace?: string }) =>
    args.window ? primary : (history ?? primary),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHealth.mockReturnValue({
    isLoading: false,
    isError: false,
    data: { tiers: [] },
  } as ReturnType<typeof useMemoryTierHealth>);
});

describe("MemoryConsumption batch34b", () => {
  it("maps dated bucket keys and compact tier counts (branches 44, 59)", () => {
    const tag = randomUUID().slice(0, 8);
    bindMemoryMocks(memoryOk());
    mockSeries.mockReturnValue(seriesOk());
    const writes = vi.fn().mockReturnValue(
      seriesOk([{ bucket: "2026-11-10T12:00:00.000Z", value: 4 }]),
    );
    const recalls = vi.fn().mockReturnValue(seriesOk());
    mockSeries.mockImplementation((metric) => (metric === "memory_writes" ? writes() : recalls()));

    render(<MemoryConsumption filters={{ window: "7d", workspace: "all" }} />);
    expect(screen.getByText("1.2K")).toBeInTheDocument();
    expect(screen.getByTestId("memory-tier-health")).toBeInTheDocument();
  });

  it("withholds chart values when series have no points (branches 98, 101)", () => {
    bindMemoryMocks(memoryOk({ tierStats: [], sources: [], pendingUnconsolidated: 0, lastRun: null }));
    mockSeries.mockReturnValue(seriesOk());

    const { container } = render(<MemoryConsumption filters={{ window: "24h", workspace: "all" }} />);
    expect(container.querySelector('[data-status-block="no_history"]')).toBeTruthy();
  });

  it("classifies unavailable tier inventory when memory-stats has no data (branch 158)", () => {
    bindMemoryMocks(
      { isLoading: false, isError: false, data: undefined } as ReturnType<typeof useMemoryStats>,
      { isLoading: false, isError: false, data: undefined } as ReturnType<typeof useMemoryStats>,
    );
    mockSeries.mockReturnValue(seriesOk());

    render(<MemoryConsumption filters={{ window: "7d", workspace: `ws-${randomUUID().slice(0, 6)}` }} />);
    expect(screen.getAllByText(/unavailable/i).length).toBeGreaterThan(0);
  });

  it("renders scoped live copy without workspace series (branch 247)", () => {
    bindMemoryMocks(
      memoryOk({
        tierStats: [{ tier: "high", count: 5 }],
        sources: [{ id: "sqlite" }],
        pendingUnconsolidated: 0,
      }),
    );
    mockSeries.mockReturnValue(seriesOk());

    render(<MemoryConsumption filters={{ window: "24h", workspace: "project-alpha" }} />);
    expect(
      screen.getByText(/Timing is withheld because \/api\/time-series cannot partition by workspace/i),
    ).toBeInTheDocument();
  });

  it("surfaces tier health error, loading, empty, and down states (branches 348–408)", () => {
    bindMemoryMocks(memoryOk());
    mockSeries.mockReturnValue(seriesOk());

    mockHealth.mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
    } as ReturnType<typeof useMemoryTierHealth>);
    const { rerender } = render(<MemoryConsumption filters={{ window: "7d", workspace: "all" }} />);
    expect(screen.getByText(/tier health is stale or unavailable/i)).toBeInTheDocument();

    mockHealth.mockReturnValue({ isLoading: true, isError: false, data: undefined } as ReturnType<typeof useMemoryTierHealth>);
    rerender(<MemoryConsumption filters={{ window: "7d", workspace: "all" }} />);
    expect(screen.getByText(/Loading memory tier health/i)).toBeInTheDocument();

    mockHealth.mockReturnValue({ isLoading: false, isError: false, data: { tiers: [] } } as ReturnType<typeof useMemoryTierHealth>);
    rerender(<MemoryConsumption filters={{ window: "7d", workspace: "all" }} />);
    expect(screen.getByText(/No memory tier health history yet/i)).toBeInTheDocument();

    mockHealth.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        tiers: [
          { tier: "high", status: "down", backend: "sqlite", count: 9 },
          { tier: "low", status: "degraded", backend: "vector", count: 2 },
          { tier: "pinned", status: "up", backend: "graph" },
        ],
      },
    } as ReturnType<typeof useMemoryTierHealth>);
    rerender(<MemoryConsumption filters={{ window: "7d", workspace: "all" }} />);
    expect(screen.getByText(/sqlite · 9 rows/i)).toBeInTheDocument();
    expect(screen.getByText(/graph$/i)).toBeInTheDocument();
  });
});
