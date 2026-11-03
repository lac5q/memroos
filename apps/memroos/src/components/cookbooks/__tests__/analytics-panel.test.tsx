import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/api-client", () => ({
  useTimeSeries: () => ({
    data: { points: [{ t: "2026-05-20", v: 1 }] },
    isLoading: false,
  }),
}));

vi.mock("@/components/shared/time-series-chart", () => ({
  TimeSeriesChart: ({ title }: { title: string }) => <div data-testid="chart">{title}</div>,
}));

import { CookbooksAnalyticsPanel } from "../analytics-panel";

describe("CookbooksAnalyticsPanel", () => {
  it("renders usage trend charts", () => {
    render(<CookbooksAnalyticsPanel />);
    expect(screen.getByText("Usage Trends")).toBeInTheDocument();
    expect(screen.getByText("Skill Executions")).toBeInTheDocument();
    expect(screen.getByText("Failure Rate")).toBeInTheDocument();
  });
});
