/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api-client", () => ({
  useRecallStats: vi.fn(),
}));

import { useRecallStats } from "@/lib/api-client";
import { SqliteHealthPanel } from "../sqlite-health-panel";

const mockStats = vi.mocked(useRecallStats);

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SqliteHealthPanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-07T16:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("SqliteHealthPanel batch30b", () => {
  it("formats GB sizes and day-based ingest timestamps", () => {
    mockStats.mockReturnValue({
      data: {
        rowCount: 2_500_000,
        dbSizeBytes: 2_147_483_648,
        lastIngest: "2026-11-01T10:00:00.000Z",
        lastRecallQuery: `query-${randomUUID().slice(0, 12)}-extra-long`,
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useRecallStats>);
    renderPanel();
    expect(screen.getByText("2.0 GB")).toBeInTheDocument();
    expect(screen.getByText("2.5M")).toBeInTheDocument();
    expect(screen.getByText("2026-11-01")).toBeInTheDocument();
    expect(screen.getByText(/\u2026/)).toBeInTheDocument();
  });

  it("shows error subtitle and succeeds on ingest", async () => {
    vi.useRealTimers();
    mockStats.mockReturnValue({
      data: { rowCount: 0, dbSizeBytes: 0, lastIngest: null, lastRecallQuery: null },
      isLoading: false,
      isError: true,
    } as ReturnType<typeof useRecallStats>);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true } as Response),
    );
    renderPanel();
    expect(screen.getByText(/Database unavailable/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Run Ingest/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Run Ingest/i })).toBeInTheDocument();
    });
  });
});
