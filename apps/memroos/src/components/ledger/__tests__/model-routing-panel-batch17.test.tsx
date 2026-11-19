/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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

function baseDashboard(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      summary: {
        totalRuns: 42,
        successRate: 0.875,
        averageQuality: 0.91,
        averageLatencyMs: 320,
      },
      timestamp: "2026-10-23T12:00:00.000Z",
    },
    isLoading: false,
    error: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDashboard.mockReturnValue(baseDashboard() as ReturnType<typeof useModelRoutingDashboard>);
  mockRecommendations.mockReturnValue({
    data: { recommendations: [] },
    isLoading: false,
    error: null,
  } as ReturnType<typeof useModelRoutingRecommendations>);
  mockEvals.mockReturnValue({
    data: { dimensions: [] },
    isLoading: false,
    error: null,
  } as ReturnType<typeof useModelRoutingEvals>);
});

describe("ModelRoutingPanel batch17", () => {
  it("shows unavailable metric envelopes when dashboard returns no summary", () => {
    mockDashboard.mockReturnValue({
      data: { summary: undefined, timestamp: "2026-10-23T12:00:00.000Z" },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);

    render(<ModelRoutingPanel />, { wrapper });

    expect(screen.getAllByText("N/A").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/returned no summary/i)).toBeInTheDocument();
  });

  it("shows blocked and error metric states from dashboard query", () => {
    mockDashboard.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as ReturnType<typeof useModelRoutingDashboard>);
    const { rerender } = render(<ModelRoutingPanel />, { wrapper });
    expect(screen.getAllByText("loading").length).toBeGreaterThanOrEqual(4);

    mockDashboard.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("batch17 routing telemetry offline"),
    } as ReturnType<typeof useModelRoutingDashboard>);
    rerender(<ModelRoutingPanel />);
    expect(screen.getAllByText("error").length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByText(/batch17 routing telemetry offline/).length).toBeGreaterThanOrEqual(1);
  });

  it("formats live success, quality, and latency percentages with null fallbacks", () => {
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

  it("renders recommendation quality N/A when averageQuality is null", () => {
    mockRecommendations.mockReturnValue({
      data: {
        recommendations: [
          {
            provider: "openai",
            model: "gpt-batch17",
            label: "Batch17 model",
            score: 0.812,
            observations: 3,
            averageQuality: null,
          },
        ],
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useModelRoutingRecommendations>);

    render(<ModelRoutingPanel />, { wrapper });
    expect(screen.getByText(/gpt-batch17/)).toBeInTheDocument();
    expect(document.querySelector('[data-routing-rec-quality-status="unavailable"]')).toBeTruthy();
    expect(screen.getByText(/no scored observations/i)).toBeInTheDocument();
  });

  it("switches task type and strategy toggles", () => {
    render(<ModelRoutingPanel />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: "sales" }));
    fireEvent.click(screen.getByRole("button", { name: "latency" }));
    expect(document.querySelector('[data-routing-scope="taskType=sales,strategy=latency"]')).toBeTruthy();
  });
});
