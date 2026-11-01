/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
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

describe("ModelRoutingPanel batch24", () => {
  it("shows unavailable metric labels and toggles task/strategy filters", () => {
    apiMock.useModelRoutingDashboard.mockReturnValue({
      data: {
        summary: {
          totalRuns: 0,
          successfulRuns: 0,
          successRate: null,
          averageQuality: null,
          averageLatencyMs: null,
        },
        timestamp: "2026-07-01T00:00:00.000Z",
        events: [],
      },
      isLoading: false,
      error: new Error("telemetry batch24"),
    });
    apiMock.useModelRoutingRecommendations.mockReturnValue({
      data: {
        taskType: "engineering",
        strategy: "balanced",
        recommendations: [{ model: "claude", averageQuality: null, averageLatencyMs: null, score: 1 }],
        timestamp: "2026-07-01T00:00:00.000Z",
      },
      isLoading: false,
      error: null,
    });
    apiMock.useModelRoutingEvals.mockReturnValue({
      data: { dimensions: [], referenceTasks: [], summary: null, timestamp: "" },
      isLoading: false,
      error: null,
    });

    render(<ModelRoutingPanel />);
    expect(screen.getAllByText(/unavailable/i).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "sales" }));
    fireEvent.click(screen.getByRole("button", { name: "cost" }));
    expect(screen.getByText(/Recommendations \(sales\/cost\)/i)).toBeInTheDocument();
  });
});
