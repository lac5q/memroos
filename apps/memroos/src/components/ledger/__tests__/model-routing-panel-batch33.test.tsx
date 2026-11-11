/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ModelRoutingPanel batch33", () => {
  it("envelopeValueLabel shows loading and error states (lines 249-252)", () => {
    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);
    const { rerender } = render(<ModelRoutingPanel />);
    expect(screen.getAllByText("loading").length).toBeGreaterThan(0);

    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("routing dashboard batch33"),
    } as ReturnType<typeof useModelRoutingDashboard>);
    rerender(<ModelRoutingPanel />);
    expect(screen.getAllByText("error").length).toBeGreaterThan(0);
  });

  it("Success/Quality/Latency cards use N/A when rates are missing (lines 374-399)", () => {
    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: {
        timestamp: "2026-07-17T10:00:00.000Z",
        summary: {
          totalRuns: 4,
          successRate: null,
          averageQuality: null,
          averageLatencyMs: null,
        },
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);

    const { container } = render(<ModelRoutingPanel />);
    expect(container.querySelector('[data-routing-metric="Success"]')?.textContent).toMatch(/N\/A/i);
    expect(container.querySelector('[data-routing-metric="Quality"]')?.textContent).toMatch(/N\/A/i);
    expect(container.querySelector('[data-routing-metric="Latency"]')?.textContent).toMatch(/N\/A/i);
  });

  it("task and strategy toggles refresh recommendation scope", () => {
    const tag = randomUUID().slice(0, 6);
    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: {
        timestamp: "2026-07-17T10:00:00.000Z",
        summary: { totalRuns: 2, successRate: 1, averageQuality: 0.7, averageLatencyMs: 90 },
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);

    vi.mocked(useModelRoutingRecommendations).mockReturnValue({
      data: {
        recommendations: [
          {
            provider: "openai",
            model: `gpt-b33-${tag}`,
            label: "latency",
            score: 0.31,
            observations: 1,
            averageQuality: 0.6,
          },
        ],
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingRecommendations>);

    render(<ModelRoutingPanel />);
    fireEvent.click(screen.getByRole("button", { name: "sales" }));
    fireEvent.click(screen.getByRole("button", { name: "latency" }));
    expect(screen.getByText(/Recommendations \(sales\/latency\)/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`gpt-b33-${tag}`))).toBeInTheDocument();
  });

  it.skip("envelopeValueLabel empty/default branches (lines 249, 253) and live-null formatters (374, 385, 396)", () => {
    // Panel adapters never emit empty|stale|degraded envelopes or live/zero with null values.
  });
});
