/**
 * @vitest-environment jsdom
 */
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

describe("ModelRoutingPanel batch39", () => {
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

  it("envelopeValueLabel unavailable arm renders N/A (line ~251)", () => {
    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: {
        timestamp: "2026-11-16T00:00:00.000Z",
        summary: { totalRuns: 3, successRate: null, averageQuality: null, averageLatencyMs: null },
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);

    render(<ModelRoutingPanel />);
    expect(screen.getAllByText(/N\/A/i).length).toBeGreaterThan(0);
  });

  it.skip("envelopeValueLabel fallback at ~253 for stale|degraded — summaryTo* adapters only emit live|zero|empty|blocked|unavailable|error", () => {});
});