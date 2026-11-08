/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ModelRoutingPanel batch31", () => {
  it("renders measured-zero routing summary cards (lines 246-247, 374-397)", () => {
    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: {
        timestamp: "2026-07-17T10:00:00.000Z",
        summary: {
          totalRuns: 0,
          successRate: 0,
          averageQuality: 0,
          averageLatencyMs: 0,
        },
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);

    const { container } = render(<ModelRoutingPanel />);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.getByText("0.00")).toBeInTheDocument();
    expect(screen.getByText("0ms")).toBeInTheDocument();
    expect(container.querySelector('[data-routing-metric="Runs"]')?.getAttribute("data-routing-metric-status")).toBe(
      "zero",
    );
  });

  it("shows unavailable quality on recommendations without scores (lines 249-253 via badge)", () => {
    const tag = randomUUID().slice(0, 6);
    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: {
        timestamp: "2026-07-17T10:00:00.000Z",
        summary: { totalRuns: 3, successRate: 1, averageQuality: 0.8, averageLatencyMs: 120 },
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);

    vi.mocked(useModelRoutingRecommendations).mockReturnValue({
      data: {
        recommendations: [
          {
            provider: "local",
            model: `gpt-batch31-${tag}`,
            label: "balanced",
            score: 0.42,
            observations: 2,
            averageQuality: null,
          },
        ],
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingRecommendations>);

    const { container } = render(<ModelRoutingPanel />);
    expect(screen.getByText(new RegExp(`gpt-batch31-${tag}`))).toBeInTheDocument();
    expect(
      container.querySelector('[data-routing-rec-quality-status="unavailable"]')?.textContent,
    ).toMatch(/unavailable/i);
  });
});
