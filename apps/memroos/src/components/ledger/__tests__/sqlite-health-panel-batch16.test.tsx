/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api-client", () => ({
  useRecallStats: vi.fn(),
}));

import { SqliteHealthPanel } from "@/components/ledger/sqlite-health-panel";
import { useRecallStats } from "@/lib/api-client";

const mockUseRecallStats = vi.mocked(useRecallStats);

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-23T12:00:00.000Z"));
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ filesProcessed: 1, rowsInserted: 1 }),
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("SqliteHealthPanel batch16", () => {
  it("formats large counts, byte sizes, relative ingest time, and truncated recall queries", () => {
    mockUseRecallStats.mockReturnValue({
      data: {
        rowCount: 2_500_000_000,
        dbSizeBytes: 1_073_741_824,
        lastIngest: "2026-10-23T11:45:00.000Z",
        lastRecallQuery: "batch16-recall-query-that-is-very-long",
        timestamp: "2026-10-23T12:00:00.000Z",
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useRecallStats>);

    render(<SqliteHealthPanel />, { wrapper: makeWrapper() });

    expect(screen.getByText("2.5B")).toBeInTheDocument();
    expect(screen.getByText("1.0 GB")).toBeInTheDocument();
    expect(screen.getByText("15 min ago")).toBeInTheDocument();
    expect(screen.getByText(/batch16-recall-query-tha…/)).toBeInTheDocument();
  });

  it("shows kilobyte-sized databases and just-now ingest timestamps", () => {
    mockUseRecallStats.mockReturnValue({
      data: {
        rowCount: 512,
        dbSizeBytes: 2048,
        lastIngest: "2026-10-23T11:59:30.000Z",
        lastRecallQuery: null,
        timestamp: "2026-10-23T12:00:00.000Z",
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useRecallStats>);

    render(<SqliteHealthPanel />, { wrapper: makeWrapper() });
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.getByText("just now")).toBeInTheDocument();
  });

  it("enters error state when ingest POST fails", async () => {
    vi.useRealTimers();
    mockUseRecallStats.mockReturnValue({
      data: {
        rowCount: 0,
        dbSizeBytes: 400,
        lastIngest: null,
        lastRecallQuery: null,
        timestamp: "2026-10-23T12:00:00.000Z",
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useRecallStats>);

    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 500 } as Response);

    render(<SqliteHealthPanel />, { wrapper: makeWrapper() });
    fireEvent.click(screen.getByRole("button", { name: /run ingest/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Ingest failed/i })).toBeInTheDocument();
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T12:00:00.000Z"));
  });
});
