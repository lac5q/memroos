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
});

describe("SqliteHealthPanel batch35b", () => {
  it("handleIngest ignores double-clicks while loading (60)", async () => {
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
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch?.();
    await waitFor(() => expect(screen.getByRole("button", { name: /Run Ingest/i })).toBeInTheDocument());
  });

  it("handleIngest resets button state after success timeout (67)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }),
    );
    renderPanel(qc);
    fireEvent.click(screen.getByRole("button", { name: /Run Ingest/i }));
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["recall-stats"] }));
    await waitFor(
      () => expect(screen.getByRole("button", { name: /Run Ingest/i })).toBeInTheDocument(),
      { timeout: 5000 },
    );
  });

  it("truncates very long lastRecallQuery preview", () => {
    const long = `b35b-${"q".repeat(48)}-${randomUUID().slice(0, 4)}`;
    mockStats.mockReturnValue({
      data: { rowCount: 2, dbSizeBytes: 2048, lastIngest: "2026-11-12T00:00:00.000Z", lastRecallQuery: long },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useRecallStats>);
    renderPanel();
    expect(screen.getByText(/\u2026/)).toBeInTheDocument();
  });
});
