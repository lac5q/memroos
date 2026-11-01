/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api-client", () => ({
  useRecallStats: vi.fn(),
}));

import { useRecallStats } from "@/lib/api-client";
import { SqliteHealthPanel } from "../sqlite-health-panel";

const mockStats = useRecallStats as ReturnType<typeof vi.fn>;

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
  mockStats.mockReturnValue({
    data: { rowCount: 10, dbSizeBytes: 2048, lastIngest: null, lastRecallQuery: null },
    isLoading: false,
    isError: false,
  });
});

describe("SqliteHealthPanel batch20", () => {
  it("marks ingest button error when fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500 }) as Response),
    );
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Run Ingest/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Ingest failed/i })).toBeInTheDocument();
    });
    vi.unstubAllGlobals();
  });

  it("shows em dash placeholders when stats missing", () => {
    mockStats.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { container } = renderPanel();
    expect(container.textContent).toContain("—");
  });
});
