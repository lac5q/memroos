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
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-07T12:00:00.000Z"));
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }),
  );
  mockTier.mockReturnValue({ data: { tiers: [] }, isLoading: false } as ReturnType<typeof useMemoryTierHealth>);
  mockEval.mockReturnValue({
    data: { ok: true, run: null, timestamp: "2026-11-07T12:00:00.000Z" },
    isLoading: false,
  } as ReturnType<typeof useMemoryEvalLatest>);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("MemoryIntelligencePanel batch30b", () => {
  it("shows just-now and day-based last-run labels", () => {
    mockStats.mockReturnValue({
      data: {
        lastRun: {
          status: "running",
          started_at: "2026-11-07T11:59:30.000Z",
          completed_at: null,
          insights_written: 0,
          error_message: null,
          batch_size: 1,
        },
        pendingUnconsolidated: 0,
        tierStats: [],
        consolidationModel: null,
        sources: [],
        recentFailures24h: 0,
        timestamp: "2026-11-07T12:00:00.000Z",
      },
      isLoading: false,
    } as ReturnType<typeof useMemoryStats>);
    const { rerender } = render(<MemoryIntelligencePanel />, { wrapper });
    expect(screen.getByText("just now")).toBeInTheDocument();

    mockStats.mockReturnValue({
      data: {
        lastRun: {
          status: "completed",
          started_at: "2026-11-01T00:00:00.000Z",
          completed_at: "2026-11-01T01:00:00.000Z",
          insights_written: 2,
          error_message: null,
          batch_size: 4,
        },
        pendingUnconsolidated: 1,
        tierStats: [],
        consolidationModel: `model-${randomUUID().slice(0, 4)}`,
        sources: [],
        recentFailures24h: 0,
        timestamp: "2026-11-07T12:00:00.000Z",
      },
      isLoading: false,
    } as ReturnType<typeof useMemoryStats>);
    rerender(<MemoryIntelligencePanel />);
    expect(screen.getByText("2026-11-01")).toBeInTheDocument();
  });

  it("surfaces failed consolidation banner and tier health branches", () => {
    mockStats.mockReturnValue({
      data: {
        lastRun: {
          status: "failed",
          started_at: "2026-11-07T10:00:00.000Z",
          completed_at: "2026-11-07T10:01:00.000Z",
          insights_written: 0,
          error_message: "provider 429 rate_limit",
          batch_size: 0,
        },
        pendingUnconsolidated: 3,
        tierStats: [{ tier: "hot", count: 1, avg_score: 0.5 }],
        consolidationModel: null,
        sources: [{ agent_id: "agent-a", cnt: 10 }],
        recentFailures24h: 3,
        timestamp: "2026-11-07T12:00:00.000Z",
      },
      isLoading: false,
    } as ReturnType<typeof useMemoryStats>);
    mockTier.mockReturnValue({
      data: {
        tiers: [
          { tier: "hot", status: "down", backend: "qdrant", detail: "timeout", count: 2 },
          { tier: "warm", status: "not_configured", backend: "neo4j", detail: null, count: undefined },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useMemoryTierHealth>);
    mockEval.mockReturnValue({
      data: {
        ok: true,
        run: {
          status: "failed",
          summary: {
            passRate: 0.4,
            passedCases: 2,
            totalCases: 5,
            p95LatencyMs: 120,
            tierFailures: ["l2"],
          },
        },
        timestamp: "2026-11-07T12:00:00.000Z",
      },
      isLoading: false,
    } as ReturnType<typeof useMemoryEvalLatest>);

    render(<MemoryIntelligencePanel />, { wrapper });
    expect(screen.getByText(/Consolidation is failing/i)).toBeInTheDocument();
    expect(screen.getByText(/failures recorded in the last 24h/i)).toBeInTheDocument();
    expect(screen.getByText("40.0%")).toBeInTheDocument();
    expect(screen.getByText("l2")).toBeInTheDocument();
  });

  it("resets button to idle after successful consolidate", async () => {
    vi.useRealTimers();
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

    render(<MemoryIntelligencePanel />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: "Run Now" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Run Now" })).toBeInTheDocument();
    });
  });
});
