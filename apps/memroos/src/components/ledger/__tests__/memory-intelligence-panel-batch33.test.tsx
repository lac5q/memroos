/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
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

beforeEach(() => {
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
  vi.unstubAllGlobals();
});

describe("MemoryIntelligencePanel batch33", () => {
  it("handleRunNow ignores duplicate clicks while loading (line 48)", async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn(() => fetchPromise);
    vi.stubGlobal("fetch", fetchMock);

    render(<MemoryIntelligencePanel />, { wrapper });
    const button = screen.getByRole("button", { name: "Run Now" });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch({ ok: true, json: async () => ({ ok: true }) } as Response);
    await waitFor(() => expect(screen.getByRole("button", { name: "Run Now" })).toBeInTheDocument());
  });

  it("handleRunNow surfaces HTTP failures (line 57)", async () => {
    const tag = randomUUID().slice(0, 6);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: tag }) }),
    );

    render(<MemoryIntelligencePanel />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: "Run Now" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Failed — click to retry" })).toBeInTheDocument(),
    );
  });
});
