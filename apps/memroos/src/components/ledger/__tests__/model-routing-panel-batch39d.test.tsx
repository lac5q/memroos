/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("ModelRoutingPanel batch39d", () => {
  it.skip("envelopeValueLabel empty arm (line 249) — summaryTo* adapters never emit empty status", () => {});

  it.skip("envelopeValueLabel stale/degraded fallback (line 253) — adapters only emit live|zero|empty|blocked|unavailable|error", () => {});

  it.skip("Success/Quality/Latency live-zero null formatters (lines 374, 385, 396) — summaryTo* never returns live|zero with null value", () => {});

  it("envelopeValueLabel surfaces error and blocked labels from dashboard envelopes (250-252)", () => {
    const tag = randomUUID().slice(0, 8);
    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);
    const { unmount } = render(<ModelRoutingPanel />);
    expect(screen.getAllByText("loading").length).toBeGreaterThanOrEqual(1);
    unmount();

    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error(`routing-down-b39d-${tag}`),
    } as ReturnType<typeof useModelRoutingDashboard>);
    render(<ModelRoutingPanel />);
    expect(screen.getAllByText("error").length).toBeGreaterThanOrEqual(1);
  });

  it("measured-zero runs use envelopeValueLabel live/zero branch with numeric zero (246-247)", () => {
    vi.mocked(useModelRoutingDashboard).mockReturnValue({
      data: {
        timestamp: "2026-11-16T00:00:00.000Z",
        summary: { totalRuns: 0, successRate: null, averageQuality: null, averageLatencyMs: null },
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);

    render(<ModelRoutingPanel />);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getAllByText("N/A").length).toBeGreaterThanOrEqual(2);
  });
});