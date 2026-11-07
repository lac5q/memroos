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

import { Waste } from "../savings-waste";

describe("savings-waste batch23", () => {
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
    api.useDelegations.mockReturnValue({
      data: { delegations: [{ status: "failed", retryCount: null }] },
      isLoading: false,
      isError: false,
    });
    api.useHiveFeed.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    api.useSkills.mockReturnValue({
      data: { skillBudget: { duplicateSkills: [] }, coverageGaps: [] },
      isLoading: false,
      isError: false,
    });
  });

  it("marks waste rows blocked when a source returns null measurements", () => {
    render(<Waste filters={{ window: "24h", workspace: "all" }} />);
    const retries = screen.getByText("Retries").closest("[data-waste-row]");
    expect(retries?.getAttribute("data-waste-state")).toBe("blocked");
  });
});
