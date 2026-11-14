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
  vi.setSystemTime(new Date("2026-11-08T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("SqliteHealthPanel batch33", () => {
  it("formatRelativeTime shows hour labels (line 22)", () => {
    mockStats.mockReturnValue({
      data: {
        rowCount: 8,
        dbSizeBytes: 2048,
        lastIngest: "2026-11-08T09:00:00.000Z",
        lastRecallQuery: `q-b33-${randomUUID().slice(0, 6)}`,
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useRecallStats>);
    renderPanel();
    expect(screen.getByText(/3 hr ago/i)).toBeInTheDocument();
  });

  it("handleIngest ignores duplicate clicks while loading (line 60)", async () => {
    vi.useRealTimers();
    mockStats.mockReturnValue({
      data: { rowCount: 0, dbSizeBytes: 0, lastIngest: null, lastRecallQuery: null },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useRecallStats>);

    let resolveFetch: (value: Response) => void = () => {};
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn(() => fetchPromise);
    vi.stubGlobal("fetch", fetchMock);

    renderPanel();
    const button = screen.getByRole("button", { name: /Run Ingest/i });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch({ ok: true, json: async () => ({ ok: true }) } as Response);
    await waitFor(() => expect(screen.getByRole("button", { name: /Run Ingest/i })).toBeInTheDocument());
  });

  it("handleIngest succeeds and returns to idle (lines 65-67)", async () => {
    vi.useRealTimers();
    mockStats.mockReturnValue({
      data: { rowCount: 2, dbSizeBytes: 512, lastIngest: null, lastRecallQuery: null },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useRecallStats>);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ingested: 1 }) }),
    );

    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Run Ingest/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Run Ingest/i })).toBeInTheDocument());
  });
});
