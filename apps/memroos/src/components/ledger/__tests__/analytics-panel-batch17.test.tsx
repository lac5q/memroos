/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api-client", () => ({
  useTimeSeries: vi.fn(),
}));

vi.mock("@/components/shared/time-series-chart", () => ({
  TimeSeriesChart: ({ title }: { title: string }) => <div data-testid="time-series-chart">{title}</div>,
}));

import { LedgerAnalyticsPanel } from "../analytics-panel";
import { useTimeSeries } from "@/lib/api-client";

const mockUseTimeSeries = vi.mocked(useTimeSeries);

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
}

function seriesState(
  metric: string,
  state: {
    points?: Array<{ bucket: string; value: number }>;
    isLoading?: boolean;
    error?: unknown;
    timestamp?: string | null;
  },
) {
  return {
    data: state.points
      ? { points: state.points, timestamp: state.timestamp ?? "2026-10-23T12:00:00.000Z" }
      : state.timestamp === null
        ? undefined
        : { points: state.points, timestamp: state.timestamp ?? "2026-10-23T12:00:00.000Z" },
    isLoading: state.isLoading ?? false,
    error: state.error ?? null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseTimeSeries.mockImplementation((metric: string) => {
    if (metric === "docs_ingested") {
      return seriesState(metric, {
        points: [{ bucket: "2026-10-22", value: 4 }],
      }) as ReturnType<typeof useTimeSeries>;
    }
    if (metric === "memory_writes") {
      return seriesState(metric, { isLoading: true }) as ReturnType<typeof useTimeSeries>;
    }
    return seriesState(metric, {
      points: [],
      timestamp: "2026-10-23T12:00:00.000Z",
    }) as ReturnType<typeof useTimeSeries>;
  });
});

describe("LedgerAnalyticsPanel batch17", () => {
  it("shows live, blocked, and empty truthful chart statuses across metrics", () => {
    render(<LedgerAnalyticsPanel />, { wrapper });

    expect(screen.getByText("Usage Trends")).toBeInTheDocument();
    expect(screen.getByText(/metric=docs_ingested/)).toBeInTheDocument();
    expect(screen.getAllByText("live").length).toBeGreaterThanOrEqual(1);
    expect(document.querySelectorAll('[data-trend-status="blocked"]').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("empty").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/returned no week buckets/i)).toBeInTheDocument();
  });

  it("shows error reason copy when a time-series source fails", () => {
    mockUseTimeSeries.mockImplementation((metric: string) => {
      if (metric === "recall_queries") {
        return seriesState(metric, { error: new Error("batch17 recall series failed") }) as ReturnType<typeof useTimeSeries>;
      }
      return seriesState(metric, { points: [{ bucket: "d1", value: 1 }] }) as ReturnType<typeof useTimeSeries>;
    });

    render(<LedgerAnalyticsPanel />, { wrapper });
    expect(screen.getByText("batch17 recall series failed")).toBeInTheDocument();
    expect(screen.getAllByText("error").length).toBeGreaterThanOrEqual(1);
  });

  it("aggregates measured-zero buckets and switches shared window toggles", () => {
    mockUseTimeSeries.mockImplementation(() =>
      seriesState("docs_ingested", {
        points: [
          { bucket: "a", value: 0 },
          { bucket: "b", value: 0 },
        ],
      }) as ReturnType<typeof useTimeSeries>,
    );

    render(<LedgerAnalyticsPanel />, { wrapper });
    expect(document.querySelectorAll('[data-trend-status="zero"]').length).toBeGreaterThanOrEqual(3);

    fireEvent.click(screen.getAllByRole("button", { name: "Day" })[0]);
    expect(document.querySelector('[data-trend-scope="day"]')).toBeTruthy();
  });
});
