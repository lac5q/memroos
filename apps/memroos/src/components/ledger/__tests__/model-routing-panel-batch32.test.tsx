/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

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

describe("ModelRoutingPanel batch32", () => {
  it("renders empty model mix envelope labels through summary helpers (branches around 249-252)", () => {
    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: {
        timestamp: "2026-07-17T10:00:00.000Z",
        summary: {
          totalRuns: 0,
          successRate: null,
          averageQuality: null,
          averageLatencyMs: null,
        },
        events: [],
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);

    const { container } = render(<ModelRoutingPanel />);
    expect(container.querySelector('[data-routing-metric="Runs"]')?.textContent).toMatch(/0|no data|N\/A/i);
    expect(container.querySelector('[data-routing-metric="Success"]')?.textContent).toMatch(/N\/A|no data|0/i);
  });
});
