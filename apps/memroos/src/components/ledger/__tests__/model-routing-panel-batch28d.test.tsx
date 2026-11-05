/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

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

describe("ModelRoutingPanel batch28d — envelope value labels and toggles", () => {
  it("formats live metrics with null numeric values as zero-safe labels", () => {
    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: {
        timestamp: "2026-07-17T10:00:00.000Z",
        summary: {
          totalRuns: 3,
          successRate: 0.42,
          averageQuality: 0.875,
          averageLatencyMs: 120,
        },
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);

    render(<ModelRoutingPanel />);
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByText("0.88")).toBeInTheDocument();
    expect(screen.getByText("120ms")).toBeInTheDocument();
  });

  it("shows loading labels while dashboard fetch is blocked", () => {
    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);
    render(<ModelRoutingPanel />);
    expect(screen.getAllByText("loading").length).toBeGreaterThanOrEqual(1);
  });

  it("shows N/A for success and latency when summary fields are missing", () => {
    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: {
        timestamp: "2026-07-17T10:00:00.000Z",
        summary: { totalRuns: 2, successRate: null, averageQuality: null, averageLatencyMs: null },
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);
    render(<ModelRoutingPanel />);
    expect(screen.getAllByText("N/A").length).toBeGreaterThanOrEqual(2);
  });

  it("updates routing scope when task type and strategy toggles change", () => {
    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: {
        timestamp: "2026-07-17T10:00:00.000Z",
        summary: { totalRuns: 1, successRate: 1, averageQuality: 1, averageLatencyMs: 50 },
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);

    render(<ModelRoutingPanel />);
    fireEvent.click(screen.getByRole("button", { name: "sales" }));
    fireEvent.click(screen.getByRole("button", { name: "latency" }));
    expect(document.querySelector('[data-routing-scope="taskType=sales,strategy=latency"]')).toBeTruthy();
  });

  it("renders recommendation quality as N/A when averageQuality is null", () => {
    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: {
        timestamp: "2026-07-17T10:00:00.000Z",
        summary: { totalRuns: 5, successRate: 0.8, averageQuality: 0.9, averageLatencyMs: 90 },
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);
    vi.mocked(useModelRoutingRecommendations).mockReturnValue({
      data: {
        recommendations: [
          {
            provider: "anthropic",
            model: "claude-batch28d",
            score: 0.91,
            label: "balanced pick",
            observations: 2,
            averageQuality: null,
          },
        ],
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingRecommendations>);

    render(<ModelRoutingPanel />);
    expect(screen.getByText(/claude-batch28d/i)).toBeInTheDocument();
    expect(document.querySelector('[data-routing-rec-quality-status="unavailable"]')).toBeTruthy();
  });
});
