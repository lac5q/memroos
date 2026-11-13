/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  useDelegations: vi.fn(),
  useHiveFeed: vi.fn(),
  useModelRoutingDashboard: vi.fn(),
  useModelUsage: vi.fn(),
  useSkills: vi.fn(),
}));

vi.mock("@/lib/api-client", () => api);

import { Cost, Savings, Waste } from "../savings-waste";

describe("savings-waste batch31 — loading, window_empty, and source error branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.useModelRoutingDashboard.mockReturnValue({
      data: { events: [], timestamp: "2026-07-01T00:00:00Z" },
      isLoading: false,
      isError: false,
    });
    api.useModelUsage.mockReturnValue({
      data: {
        usage: { models: [], total: { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreation: 0, requests: 0 } },
        timestamp: "2026-07-01T00:00:00Z",
      },
      isLoading: false,
      isError: false,
    });
    api.useDelegations.mockReturnValue({ data: { delegations: [] }, isLoading: false, isError: false });
    api.useHiveFeed.mockReturnValue({ data: { actions: [] }, isLoading: false, isError: false });
    api.useSkills.mockReturnValue({
      data: { skillBudget: { duplicateSkills: [] }, coverageGaps: [] },
      isLoading: false,
      isError: false,
    });
  });

  it("Cost panel shows loading branch for per-model usage", () => {
    api.useModelRoutingDashboard.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
    render(<Cost filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByText(/Loading per-model usage/i)).toBeInTheDocument();
  });

  it("Cost panel reports window_empty when costed history exists outside window", () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    api.useModelRoutingDashboard.mockReturnValue({
      data: {
        events: [
          {
            agentId: "codex",
            model: "gpt-b31",
            createdAt: old,
            estimatedCostUsd: 0.1,
            inputTokens: 1,
            outputTokens: 1,
          },
        ],
        timestamp: old,
      },
      isLoading: false,
      isError: false,
    });
    render(<Cost filters={{ window: "24h", workspace: "all" }} />);
    expect(document.querySelector('[data-status-block="window_empty"]')).toBeTruthy();
  });

  it("Savings withholds sparkline when model usage errors", () => {
    api.useModelUsage.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error("down") });
    render(<Savings filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getAllByText(/Failed to load \/api\/model-usage/i).length).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('[data-status-block="savings-sparkline-withheld"]')).toBeTruthy();
  });

  it("Waste reports combined source errors across hive, delegations, and skills", () => {
    api.useHiveFeed.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error("hive down") });
    api.useDelegations.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("delegations down"),
    });
    api.useSkills.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error("skills down") });
    render(<Waste />);
    expect(screen.getByText(/Source error/i)).toBeInTheDocument();
    expect(screen.getByText(/Failed to load \/api\/hive/i)).toBeInTheDocument();
    expect(screen.getByText(/Failed to load \/api\/delegations/i)).toBeInTheDocument();
    expect(screen.getByText(/Failed to load \/api\/skills/i)).toBeInTheDocument();
  });
});
