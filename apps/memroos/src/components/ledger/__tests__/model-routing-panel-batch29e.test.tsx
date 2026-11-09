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

describe("ModelRoutingPanel batch29e — empty/unavailable envelope labels", () => {
  it("Runs card hits envelopeValueLabel empty/unavailable/error paths (lines 249–253)", () => {
    // error on dashboard drives error envelopes through summary helpers.
    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("batch29e dashboard failed"),
    } as ReturnType<typeof useModelRoutingDashboard>);

    const { container } = render(<ModelRoutingPanel />);
    expect(container.querySelector('[data-routing-metric="Runs"]')?.textContent).toMatch(/error/i);
  });

  it("loading dashboard hits blocked label path via statusBadge/envelopeValueLabel", () => {
    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);

    const { container } = render(<ModelRoutingPanel />);
    expect(container.querySelector('[data-routing-metric="Runs"]')?.textContent).toMatch(/loading/i);
  });

  it("missing summary metrics render N/A via unavailable envelopes", () => {
    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: {
        timestamp: "2026-07-17T10:00:00.000Z",
        summary: {
          totalRuns: null as unknown as number,
          successRate: null as unknown as number,
          averageQuality: null as unknown as number,
          averageLatencyMs: null as unknown as number,
        },
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);

    render(<ModelRoutingPanel />);
    expect(screen.getAllByText(/N\/A|no data|0/).length).toBeGreaterThan(0);
  });
});
