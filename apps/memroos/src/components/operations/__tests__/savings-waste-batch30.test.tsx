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

describe("savings-waste batch30", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.useModelRoutingDashboard.mockReturnValue({
      data: { events: [], timestamp: "2026-07-01T00:00:00Z" },
      isLoading: false,
      isError: false,
    });
    api.useModelUsage.mockReturnValue({
      data: {
        usage: {
          models: [{ name: "gpt-batch30", totalTokens: 900, inputTokens: 400, outputTokens: 500, cacheRead: 0, requests: 3 }],
          total: { inputTokens: 400, outputTokens: 500, cacheRead: 0, cacheCreation: 0, requests: 3 },
        },
        timestamp: "2026-07-01T00:00:00Z",
      },
      isLoading: false,
      isError: false,
    });
    api.useDelegations.mockReturnValue({ data: { delegations: [] }, isLoading: false, isError: false });
    api.useHiveFeed.mockReturnValue({ data: { actions: [] }, isLoading: false, isError: false });
    api.useSkills.mockReturnValue({
      data: { skillBudget: { duplicateSkills: ["dup-b30"] }, coverageGaps: ["gap-b30"] },
      isLoading: false,
      isError: false,
    });
  });

  it("Cost live spend with costed and missing rows", () => {
    const now = new Date().toISOString();
    api.useModelRoutingDashboard.mockReturnValue({
      data: {
        events: [
          {
            agentId: "codex-cli-agent",
            model: "gpt-batch30",
            createdAt: now,
            estimatedCostUsd: 0.25,
            inputTokens: 10,
            outputTokens: 20,
          },
          {
            agentId: "qwen-engineer",
            model: "qwen-batch30",
            createdAt: now,
            estimatedCostUsd: null,
            inputTokens: 5,
            outputTokens: 5,
          },
        ],
        timestamp: now,
      },
      isLoading: false,
      isError: false,
    });

    render(<Cost filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByText(/Cost · last 24 hours/i)).toBeInTheDocument();
    expect(document.querySelector('[data-status-block="stale_or_error"]')).toBeTruthy();
  });

  it("Savings sparkline renders when model usage is live", () => {
    render(<Savings filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByText(/3 requests/i)).toBeInTheDocument();
    expect(screen.getByText(/EXPLICIT NON-LIVE STATE/i)).toBeInTheDocument();
  });

  it("Waste reports live duplicate skills and coverage gaps", () => {
    render(<Waste filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByText("Duplicate skills").closest("[data-waste-row]")?.getAttribute("data-waste-state")).toBe("live");
    expect(screen.getByText("Coverage gaps").closest("[data-waste-row]")?.getAttribute("data-waste-state")).toBe("live");
    expect(screen.getAllByText("1").length).toBeGreaterThanOrEqual(2);
  });
});
