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

import { Cost, Waste } from "../savings-waste";

describe("savings-waste batch22", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.useModelRoutingDashboard.mockReturnValue({
      data: { events: [], timestamp: "2026-07-01T00:00:00Z" },
      isLoading: false,
      isError: false,
    });
    api.useModelUsage.mockReturnValue({
      data: { usage: { models: [], total: { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreation: 0, requests: 0 } }, timestamp: "2026-07-01T00:00:00Z" },
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

  it("Cost excludes null agent events for local workspace filter", () => {
    api.useModelRoutingDashboard.mockReturnValue({
      data: {
        events: [
          { agentId: null, createdAt: new Date().toISOString(), costUsd: 1 },
          { agentId: "codex-cli-agent", createdAt: new Date().toISOString(), costUsd: 2 },
        ],
        timestamp: "2026-07-01T00:00:00Z",
      },
      isLoading: false,
      isError: false,
    });

    render(<Cost filters={{ window: "24h", workspace: "local" }} />);
    expect(screen.getByText("Cost · last 24 hours")).toBeInTheDocument();
  });

  it("Waste marks blocked rows when a source is still loading", () => {
    api.useHiveFeed.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    render(<Waste filters={{ window: "24h", workspace: "all" }} />);
    const retries = screen.getByText("Retries").closest("[data-waste-row]");
    expect(retries?.getAttribute("data-waste-state")).toBe("loading");
  });
});
