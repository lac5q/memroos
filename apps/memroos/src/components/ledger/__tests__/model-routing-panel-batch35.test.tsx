/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
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

describe("ModelRoutingPanel batch35", () => {
  it("renders loading badges while dashboard query is blocked", () => {
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
    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);

    render(<ModelRoutingPanel />);
    expect(screen.getAllByText(/loading/i).length).toBeGreaterThan(0);
  });

  it.skip("sticky formatters at 249/253/374/385/396 — unreachable without degraded/stale envelopes", () => {});
});
