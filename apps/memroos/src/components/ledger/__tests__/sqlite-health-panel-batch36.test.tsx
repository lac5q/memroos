/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api-client", () => ({
  useRecallStats: vi.fn(),
}));

import { useRecallStats } from "@/lib/api-client";
import { SqliteHealthPanel } from "../sqlite-health-panel";

const mockStats = vi.mocked(useRecallStats);

function renderPanel(qc?: QueryClient) {
  const client =
    qc ??
    new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  return render(
    <QueryClientProvider client={client}>
      <SqliteHealthPanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStats.mockReturnValue({
    data: { rowCount: 1, dbSizeBytes: 1024, lastIngest: null, lastRecallQuery: null },
    isLoading: false,
    isError: false,
  } as ReturnType<typeof useRecallStats>);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SqliteHealthPanel batch36", () => {
  it("handleIngest returns early when already loading (60)", async () => {
    let resolveFetch: (() => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = () => resolve({ ok: true, json: async () => ({ ok: true }) } as Response);
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderPanel();
    const button = screen.getByRole("button", { name: /Run Ingest/i });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("button", { name: /Ingesting/i })).toBeInTheDocument());
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch?.();
    await waitFor(() => expect(screen.getByRole("button", { name: /Run Ingest/i })).toBeInTheDocument());
  });

  it("handleIngest setTimeout callback resets idle state (67)", async () => {
    vi.useFakeTimers();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries").mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }),
    );
    renderPanel(qc);
    fireEvent.click(screen.getByRole("button", { name: /Run Ingest/i }));
    await vi.waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /Run Ingest/i })).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(2000);
    expect(screen.getByRole("button", { name: /Run Ingest/i })).toBeInTheDocument();
  });
});
