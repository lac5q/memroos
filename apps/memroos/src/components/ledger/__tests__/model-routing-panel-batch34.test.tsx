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

describe("ModelRoutingPanel batch34", () => {
  it("envelopeValueLabel returns no data and error arms (stmts 249, 253)", () => {
    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("routing batch34"),
    } as ReturnType<typeof useModelRoutingDashboard>);

    render(<ModelRoutingPanel />);
    expect(screen.getAllByText("error").length).toBeGreaterThan(0);

    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: {
        timestamp: "2026-07-17T10:00:00.000Z",
        summary: { totalRuns: 0, successRate: null, averageQuality: null, averageLatencyMs: null },
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);

    const { container } = render(<ModelRoutingPanel />);
    expect(container.querySelector('[data-routing-metric="Runs"]')?.textContent).toMatch(/measured zero/);
    expect(container.querySelector('[data-routing-metric="Success"]')?.getAttribute("data-routing-metric-status")).toBe(
      "unavailable",
    );
    expect(container.querySelector('[data-routing-metric="Success"]')?.textContent).toMatch(/N\/A/i);
  });

  it("renders live Success/Quality/Latency formatters with measured values", () => {
    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: {
        timestamp: "2026-07-17T10:00:00.000Z",
        summary: { totalRuns: 12, successRate: 0.8125, averageQuality: 0.667, averageLatencyMs: 145 },
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);

    const tag = randomUUID().slice(0, 6);
    vi.mocked(useModelRoutingRecommendations).mockReturnValue({
      data: {
        recommendations: [
          {
            provider: "openai",
            model: `gpt-b34-${tag}`,
            label: "balanced",
            score: 0.42,
            observations: 3,
            averageQuality: null,
          },
        ],
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingRecommendations>);

    const { container } = render(<ModelRoutingPanel />);
    expect(container.querySelector('[data-routing-metric="Success"]')?.textContent).toMatch(/81%/);
    expect(container.querySelector('[data-routing-metric="Quality"]')?.textContent).toMatch(/0\.67/);
    expect(container.querySelector('[data-routing-metric="Latency"]')?.textContent).toMatch(/145ms/);
    expect(screen.getByText(new RegExp(`gpt-b34-${tag}`))).toBeInTheDocument();
    expect(document.querySelector('[data-routing-rec-quality-status="unavailable"]')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "support" }));
    fireEvent.click(screen.getByRole("button", { name: "cost" }));
    expect(screen.getByText(/Recommendations \(support\/cost\)/)).toBeInTheDocument();
  });

  it("surfaces recommendation and eval load failures", () => {
    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: {
        timestamp: "2026-07-17T10:00:00.000Z",
        summary: { totalRuns: 2, successRate: 1, averageQuality: 0.8, averageLatencyMs: 90 },
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);

    vi.mocked(useModelRoutingRecommendations).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("rec batch34"),
    } as ReturnType<typeof useModelRoutingRecommendations>);
    vi.mocked(useModelRoutingEvals).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: "eval string batch34",
    } as ReturnType<typeof useModelRoutingEvals>);

    render(<ModelRoutingPanel />);
    expect(document.querySelector('[data-routing-rec-status="error"]')).toBeTruthy();
    expect(screen.getByText(/unknown error/)).toBeInTheDocument();
  });

  it.skip("live/zero cards with null value formatters (stmts 374, 385, 396)", () => {
    // summaryTo* adapters never return live|zero with null value; envelopeValueLabel fallback only fires for other statuses.
  });
});
