/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/api-client", () => ({
  useModelRoutingDashboard: vi.fn(),
  useModelRoutingEvals: vi.fn(),
  useModelRoutingRecommendations: vi.fn(),
}));

import { ModelRoutingPanel } from "../model-routing-panel";
import {
  useModelRoutingDashboard,
  useModelRoutingEvals,
  useModelRoutingRecommendations,
} from "@/lib/api-client";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useModelRoutingEvals).mockReturnValue({
    data: { dimensions: [] },
    isLoading: false,
    error: null,
  } as ReturnType<typeof useModelRoutingEvals>);
  vi.mocked(useModelRoutingRecommendations).mockReturnValue({
    data: { recommendations: [] },
    isLoading: false,
    error: null,
  } as ReturnType<typeof useModelRoutingRecommendations>);
});

describe("ModelRoutingPanel batch28e — envelopeValueLabel branches", () => {
  it("formats live runs with null numeric value as 0 (lines 246-247)", () => {
    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: {
        timestamp: "2026-07-17T10:00:00.000Z",
        summary: {
          totalRuns: null as unknown as number,
          successRate: 0.5,
          averageQuality: 0.5,
          averageLatencyMs: 10,
        },
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);

    render(<ModelRoutingPanel />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("shows error, empty, blocked, and unavailable labels (lines 249-253)", () => {
    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("batch28e routing error"),
    } as ReturnType<typeof useModelRoutingDashboard>);
    const { rerender } = render(<ModelRoutingPanel />);
    expect(screen.getAllByText("error").length).toBeGreaterThanOrEqual(1);

    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: {
        timestamp: "2026-07-17T10:00:00.000Z",
        summary: { totalRuns: 0, successRate: null, averageQuality: null, averageLatencyMs: null },
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);
    rerender(<ModelRoutingPanel />);
    expect(screen.getAllByText("N/A").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("measured zero").length).toBeGreaterThanOrEqual(1);

    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);
    rerender(<ModelRoutingPanel />);
    expect(screen.getAllByText("loading").length).toBeGreaterThanOrEqual(1);
  });

  it("renders null-percent, null-quality, and null-latency labels on live cards (lines 374,385,396)", () => {
    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: {
        timestamp: "2026-07-17T10:00:00.000Z",
        summary: {
          totalRuns: 2,
          successRate: null as unknown as number,
          averageQuality: null as unknown as number,
          averageLatencyMs: null as unknown as number,
        },
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);

    render(<ModelRoutingPanel />);
    expect(screen.getAllByText("N/A").length).toBeGreaterThanOrEqual(3);
  });
});
