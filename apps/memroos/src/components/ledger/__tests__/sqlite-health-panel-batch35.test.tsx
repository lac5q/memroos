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
  vi.unstubAllGlobals();
});

describe("SqliteHealthPanel batch35", () => {
  it("handleIngest invalidates recall-stats on success (fn 67)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }),
    );
    renderPanel(qc);
    fireEvent.click(screen.getByRole("button", { name: /Run Ingest/i }));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["recall-stats"] }),
    );
  });

  it("handleIngest surfaces error button state when POST fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }),
    );
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Run Ingest/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Ingest failed/i })).toBeInTheDocument(),
    );
  });

  it("truncates long lastRecallQuery previews", () => {
    const long = `batch35-${"x".repeat(40)}-${randomUUID().slice(0, 4)}`;
    mockStats.mockReturnValue({
      data: { rowCount: 3, dbSizeBytes: 4096, lastIngest: null, lastRecallQuery: long },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useRecallStats>);
    renderPanel();
    expect(screen.getByText(/\u2026/)).toBeInTheDocument();
  });
});
