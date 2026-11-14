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
  vi.setSystemTime(new Date("2026-11-08T09:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("SqliteHealthPanel batch31", () => {
  it("formatRelativeTime shows minutes and hours (lines 22–23)", () => {
    mockStats.mockReturnValue({
      data: {
        rowCount: 12,
        dbSizeBytes: 4096,
        lastIngest: "2026-11-08T08:30:00.000Z",
        lastRecallQuery: `q-b31-${randomUUID().slice(0, 10)}`,
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useRecallStats>);
    renderPanel();
    expect(screen.getByText("30 min ago")).toBeInTheDocument();
  });

  it("formatRelativeTime shows just now for recent ingests (line 24)", () => {
    mockStats.mockReturnValue({
      data: {
        rowCount: 3,
        dbSizeBytes: 1024,
        lastIngest: "2026-11-08T08:59:30.000Z",
        lastRecallQuery: null,
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useRecallStats>);
    renderPanel();
    expect(screen.getByText("just now")).toBeInTheDocument();
  });

  it("handleIngest surfaces HTTP errors (lines 60, 69)", async () => {
    vi.useRealTimers();
    mockStats.mockReturnValue({
      data: { rowCount: 0, dbSizeBytes: 0, lastIngest: null, lastRecallQuery: null },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useRecallStats>);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503 } as Response),
    );
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Run Ingest/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Ingest failed/i })).toBeInTheDocument();
    });
  });
});
