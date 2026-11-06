import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/api-client", () => ({
  useTimeSeries: () => ({
    data: { points: [{ t: "2026-07-01", v: 3 }] },
    isLoading: false,
  }),
}));

vi.mock("@/components/shared/time-series-chart", () => ({
  TimeSeriesChart: ({ title }: { title: string }) => <div data-testid="chart">{title}</div>,
}));

import { LibraryAnalyticsPanel } from "../analytics-panel";

describe("LibraryAnalyticsPanel", () => {
  it("renders usage trend charts", () => {
    render(<LibraryAnalyticsPanel />);
    expect(screen.getByText("Usage Trends")).toBeInTheDocument();
    expect(screen.getByText("Document Ingest Rate")).toBeInTheDocument();
    expect(screen.getByText("Collection Growth")).toBeInTheDocument();
  });
});
