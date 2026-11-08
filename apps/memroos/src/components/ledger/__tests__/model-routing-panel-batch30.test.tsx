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
    data: { dimensions: [{ id: "dim-b30", label: "Batch30 Dim", rubric: "rubric" }] },
    isLoading: false,
    error: null,
  } as ReturnType<typeof useModelRoutingEvals>);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ModelRoutingPanel batch30", () => {
  it("envelopeValueLabel surfaces unavailable, error, and blocked paths (lines 249–253)", () => {
    vi.mocked(useModelRoutingRecommendations).mockReturnValue({
      data: { recommendations: [] },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingRecommendations>);

    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error(`routing batch30 ${randomUUID().slice(0, 6)}`),
    } as ReturnType<typeof useModelRoutingDashboard>);
    const { rerender, container } = render(<ModelRoutingPanel />);
    expect(container.querySelector('[data-routing-metric="Runs"]')?.textContent).toMatch(/error/i);

    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);
    rerender(<ModelRoutingPanel />);
    expect(container.querySelector('[data-routing-metric="Runs"]')?.textContent).toMatch(/loading/i);

    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: {
        timestamp: "2026-07-17T10:00:00.000Z",
        summary: { totalRuns: 3, successRate: null, averageQuality: null, averageLatencyMs: null },
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);
    rerender(<ModelRoutingPanel />);
    expect(screen.getAllByText("N/A").length).toBeGreaterThanOrEqual(2);
  });

  it("formats live success, quality, and latency cards (branches around 374–396)", () => {
    vi.mocked(useModelRoutingRecommendations).mockReturnValue({
      data: {
        recommendations: [
          {
            provider: "openai",
            model: "gpt-batch30",
            label: "balanced",
            score: 0.91,
            observations: 4,
            averageQuality: null,
          },
        ],
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingRecommendations>);

    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: {
        timestamp: "2026-07-17T10:00:00.000Z",
        summary: {
          totalRuns: 12,
          successRate: 0.825,
          averageQuality: 0.712,
          averageLatencyMs: 240,
        },
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);

    render(<ModelRoutingPanel />);
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("83%")).toBeInTheDocument();
    expect(screen.getByText("0.71")).toBeInTheDocument();
    expect(screen.getByText("240ms")).toBeInTheDocument();
    expect(screen.getByText(/gpt-batch30/)).toBeInTheDocument();
  });

  it("switches task type and strategy toggles", () => {
    vi.mocked(useModelRoutingRecommendations).mockReturnValue({
      data: { recommendations: [] },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingRecommendations>);
    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: {
        timestamp: "2026-07-17T10:00:00.000Z",
        summary: { totalRuns: 0, successRate: null, averageQuality: null, averageLatencyMs: null },
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);

    const { container } = render(<ModelRoutingPanel />);
    fireEvent.click(screen.getByRole("button", { name: "sales" }));
    fireEvent.click(screen.getByRole("button", { name: "latency" }));
    expect(container.querySelector('[data-routing-scope]')?.getAttribute("data-routing-scope")).toContain("sales");
    expect(container.querySelector('[data-routing-scope]')?.getAttribute("data-routing-scope")).toContain("latency");
  });
});
