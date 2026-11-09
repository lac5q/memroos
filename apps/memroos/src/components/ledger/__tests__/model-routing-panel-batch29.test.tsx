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

describe("ModelRoutingPanel batch29 — toLocaleString, zero/null metric cards", () => {
  it("Runs card uses toLocaleString for live non-null total (line 247 branch via envelopeValueLabel)", () => {
    const bigTotal = 12004 + (randomUUID().length % 7);
    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: {
        timestamp: "2026-07-17T10:00:00.000Z",
        summary: {
          totalRuns: bigTotal,
          successRate: 0.5,
          averageQuality: 0.5,
          averageLatencyMs: 10,
        },
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);

    const { container } = render(<ModelRoutingPanel />);
    const runsCard = container.querySelector('[data-routing-metric="Runs"]');
    expect(runsCard?.textContent).toContain(bigTotal.toLocaleString());
  });

  it("Success/Quality/Latency: 0%, 0.00 from live metrics; N/A when latency is absent (lines 375, 388, 249)", () => {
    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: {
        timestamp: "2026-07-17T10:00:00.000Z",
        summary: {
          totalRuns: 3,
          successRate: 0,
          averageQuality: 0,
          averageLatencyMs: null as unknown as number,
        },
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);

    const { container } = render(<ModelRoutingPanel />);
    const successCard = container.querySelector('[data-routing-metric="Success"]');
    const qualityCard = container.querySelector('[data-routing-metric="Quality"]');
    const latencyCard = container.querySelector('[data-routing-metric="Latency"]');
    expect(successCard?.textContent).toContain("0%");
    expect(qualityCard?.textContent).toContain("0.00");
    expect(latencyCard?.textContent).toContain("N/A");
  });
});
