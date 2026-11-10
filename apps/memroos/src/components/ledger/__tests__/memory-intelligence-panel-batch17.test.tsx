/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api-client", () => ({
  useMemoryStats: vi.fn(),
  useMemoryTierHealth: vi.fn(),
  useMemoryEvalLatest: vi.fn(),
}));

import { MemoryIntelligencePanel } from "../memory-intelligence-panel";
import { useMemoryEvalLatest, useMemoryStats, useMemoryTierHealth } from "@/lib/api-client";

const mockUseMemoryStats = vi.mocked(useMemoryStats);
const mockUseMemoryTierHealth = vi.mocked(useMemoryTierHealth);
const mockUseMemoryEvalLatest = vi.mocked(useMemoryEvalLatest);

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-23T12:00:00.000Z"));
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }),
  );

  mockUseMemoryTierHealth.mockReturnValue({
    data: { tiers: [], timestamp: "2026-10-23T12:00:00.000Z" },
    isLoading: false,
  } as ReturnType<typeof useMemoryTierHealth>);
  mockUseMemoryEvalLatest.mockReturnValue({
    data: { ok: true, run: null, timestamp: "2026-10-23T12:00:00.000Z" },
    isLoading: false,
  } as ReturnType<typeof useMemoryEvalLatest>);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("MemoryIntelligencePanel batch17", () => {
  it("formats relative last-run timestamps and indexed source chips", () => {
    mockUseMemoryStats.mockReturnValue({
      data: {
        lastRun: {
          status: "completed",
          started_at: "2026-10-23T11:58:00.000Z",
          completed_at: "2026-10-23T11:59:00.000Z",
          insights_written: 7,
          error_message: null,
        },
        pendingUnconsolidated: 2,
        tierStats: [],
        consolidationModel: "batch17-model",
        sources: [
          { agent_id: "claude-sonnet-engineer", cnt: 1200 },
          { agent_id: "codex-cli-agent", cnt: 45 },
        ],
        recentFailures24h: 0,
        timestamp: "2026-10-23T12:00:00.000Z",
      },
      isLoading: false,
    } as ReturnType<typeof useMemoryStats>);

    render(<MemoryIntelligencePanel />, { wrapper });

    expect(screen.getByText("1 min ago")).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet-engineer")).toBeInTheDocument();
    expect(screen.getByText("1,200")).toBeInTheDocument();
    expect(screen.getByText("45")).toBeInTheDocument();
  });

  it("shows hour-ago formatting for older consolidation runs", () => {
    mockUseMemoryStats.mockReturnValue({
      data: {
        lastRun: {
          status: "completed",
          started_at: "2026-10-23T09:30:00.000Z",
          completed_at: "2026-10-23T09:45:00.000Z",
          insights_written: 1,
          error_message: null,
        },
        pendingUnconsolidated: 0,
        tierStats: [],
        consolidationModel: null,
        sources: [],
        recentFailures24h: 0,
        timestamp: "2026-10-23T12:00:00.000Z",
      },
      isLoading: false,
    } as ReturnType<typeof useMemoryStats>);

    render(<MemoryIntelligencePanel />, { wrapper });
    expect(screen.getByText("2 hr ago")).toBeInTheDocument();
  });

  it("enters error state when consolidate POST fails", async () => {
    vi.useRealTimers();
    mockUseMemoryStats.mockReturnValue({
      data: {
        lastRun: null,
        pendingUnconsolidated: 0,
        tierStats: [],
        consolidationModel: null,
        sources: [],
        recentFailures24h: 0,
        timestamp: "2026-10-23T12:00:00.000Z",
      },
      isLoading: false,
    } as ReturnType<typeof useMemoryStats>);

    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 503 } as Response);

    render(<MemoryIntelligencePanel />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: "Run Now" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Failed — click to retry" })).toBeInTheDocument();
    });
  });
});
