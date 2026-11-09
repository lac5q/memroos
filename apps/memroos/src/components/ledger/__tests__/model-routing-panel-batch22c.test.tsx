/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({
  useModelRoutingDashboard: vi.fn(),
  useModelRoutingRecommendations: vi.fn(),
  useModelRoutingEvals: vi.fn(),
}));

import { ModelRoutingPanel } from "../model-routing-panel";
import {
  useModelRoutingDashboard,
  useModelRoutingEvals,
  useModelRoutingRecommendations,
} from "@/lib/api-client";

const mockDashboard = vi.mocked(useModelRoutingDashboard);
const mockRecommendations = vi.mocked(useModelRoutingRecommendations);
const mockEvals = vi.mocked(useModelRoutingEvals);

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEvals.mockReturnValue({ data: { dimensions: [] }, isLoading: false, error: null } as ReturnType<typeof useModelRoutingEvals>);
  mockRecommendations.mockReturnValue({ data: { recommendations: [] }, isLoading: false, error: null } as ReturnType<typeof useModelRoutingRecommendations>);
});

describe("ModelRoutingPanel batch22c — envelope value labels", () => {
  it("shows no data and zero fallbacks for empty measured summaries", () => {
    mockDashboard.mockReturnValue({
      data: {
        summary: {
          totalRuns: 0,
          successRate: null,
          averageQuality: null,
          averageLatencyMs: null,
        },
        timestamp: "2026-10-23T12:00:00.000Z",
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);

    render(<ModelRoutingPanel />, { wrapper });
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getAllByText("N/A").length).toBeGreaterThanOrEqual(2);
  });
});
