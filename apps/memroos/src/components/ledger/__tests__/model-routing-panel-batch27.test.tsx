/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  useModelRoutingDashboard: vi.fn(),
  useModelRoutingRecommendations: vi.fn(),
  useModelRoutingEvals: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  useModelRoutingDashboard: apiMock.useModelRoutingDashboard,
  useModelRoutingRecommendations: apiMock.useModelRoutingRecommendations,
  useModelRoutingEvals: apiMock.useModelRoutingEvals,
}));

import { ModelRoutingPanel } from "../model-routing-panel";

describe("ModelRoutingPanel batch27 — envelope value labels", () => {
  it("renders zero-valued live metrics and error states distinctly", () => {
    apiMock.useModelRoutingDashboard.mockReturnValue({
      data: {
        summary: {
          totalRuns: 0,
          successfulRuns: 0,
          successRate: 0,
          averageQuality: 0,
          averageLatencyMs: 0,
        },
        timestamp: "2026-07-01T00:00:00.000Z",
        events: [],
      },
      isLoading: false,
      error: null,
    });
    apiMock.useModelRoutingRecommendations.mockReturnValue({
      data: { taskType: "engineering", strategy: "balanced", recommendations: [], timestamp: "" },
      isLoading: false,
      error: null,
    });
    apiMock.useModelRoutingEvals.mockReturnValue({
      data: { dimensions: [], referenceTasks: [], summary: null, timestamp: "" },
      isLoading: false,
      error: null,
    });

    const { rerender } = render(<ModelRoutingPanel />);
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.getByText("0.00")).toBeInTheDocument();

    apiMock.useModelRoutingDashboard.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error("telemetry down"),
    });
    rerender(<ModelRoutingPanel />);
    expect(screen.getAllByText("error").length).toBeGreaterThan(0);
  });
});
