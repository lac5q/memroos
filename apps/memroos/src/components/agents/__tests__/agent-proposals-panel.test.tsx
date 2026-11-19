import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const api = vi.hoisted(() => ({
  useAgentProposals: vi.fn(),
  useApproveMutation: vi.fn(),
  useRejectMutation: vi.fn(),
  useApplyMutation: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  useAgentProposals: api.useAgentProposals,
  useApproveMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useRejectMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useApplyMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { AgentProposalsPanel } from "../agent-proposals-panel";

describe("AgentProposalsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading spinner while proposals load", () => {
    api.useAgentProposals.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = render(<AgentProposalsPanel />);
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("shows empty state when no proposals", () => {
    api.useAgentProposals.mockReturnValue({
      isLoading: false,
      data: { proposals: [], timestamp: "2026-05-20T00:00:00.000Z" },
    });
    render(<AgentProposalsPanel />);
    expect(screen.getByText(/No agent proposals yet/i)).toBeInTheDocument();
  });

  it("lists a pending proposal", () => {
    api.useAgentProposals.mockReturnValue({
      isLoading: false,
      data: {
        proposals: [
          {
            id: "p1",
            traceId: "t1",
            runId: "r1",
            agentId: "agent.test.local",
            proposalType: "skill_addition",
            status: "pending",
            diff: { skill: "standup" },
            rationale: "Add standup skill for morning sync.",
            forecastWDelta: 0.05,
            baselineW: 0.7,
            createdAt: "2026-05-20T00:00:00.000Z",
          },
        ],
        timestamp: "2026-05-20T00:00:00.000Z",
      },
    });

    render(<AgentProposalsPanel />);
    expect(screen.getByText("agent.test.local")).toBeInTheDocument();
    expect(screen.getByText(/Add standup skill/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });
});
