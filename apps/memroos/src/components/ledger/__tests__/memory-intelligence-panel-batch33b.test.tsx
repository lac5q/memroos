/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api-client", () => ({
  useMemoryStats: vi.fn(),
  useMemoryTierHealth: vi.fn(),
  useMemoryEvalLatest: vi.fn(),
}));

import { MemoryIntelligencePanel } from "../memory-intelligence-panel";
import { useMemoryEvalLatest, useMemoryStats, useMemoryTierHealth } from "@/lib/api-client";

const mockStats = vi.mocked(useMemoryStats);
const mockTier = vi.mocked(useMemoryTierHealth);
const mockEval = vi.mocked(useMemoryEvalLatest);

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe("MemoryIntelligencePanel batch33b", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
    mockTier.mockReturnValue({ data: { tiers: [] }, isLoading: false } as ReturnType<typeof useMemoryTierHealth>);
    mockEval.mockReturnValue({
      data: { ok: true, run: null, timestamp: "2026-11-07T12:00:00.000Z" },
      isLoading: false,
    } as ReturnType<typeof useMemoryEvalLatest>);
    mockStats.mockReturnValue({
      data: {
        lastRun: null,
        pendingUnconsolidated: 0,
        tierStats: [],
        consolidationModel: null,
        sources: [],
        recentFailures24h: 0,
        timestamp: "2026-11-07T12:00:00.000Z",
      },
      isLoading: false,
    } as ReturnType<typeof useMemoryStats>);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("handleRunNow success invalidates stats and returns to idle (lines 55-56)", async () => {
    const invalidateSpy = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }),
    );

    render(<MemoryIntelligencePanel />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: "Run Now" }));
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["memory-stats"] }));
    const button = screen.getByRole("button", { name: "Run Now" });
    expect(button.className).toMatch(/emerald/);

    await vi.advanceTimersByTimeAsync(2000);
    await waitFor(() => expect(screen.getByRole("button", { name: "Run Now" }).className).toMatch(/stone/));
    invalidateSpy.mockRestore();
  });
});
