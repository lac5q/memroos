/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const mutations = vi.hoisted(() => ({
  approve: { mutate: vi.fn(), isPending: false },
  reject: { mutate: vi.fn(), isPending: false },
  apply: { mutate: vi.fn(), isPending: false },
}));

vi.mock("@/lib/api-client", () => ({
  useAgentProposals: vi.fn(),
  useApproveMutation: () => mutations.approve,
  useRejectMutation: () => mutations.reject,
  useApplyMutation: () => mutations.apply,
}));

import { useAgentProposals } from "@/lib/api-client";
import { AgentProposalsPanel } from "../agent-proposals-panel";

const mockList = useAgentProposals as ReturnType<typeof vi.fn>;

const pendingProposal = {
  id: "prop-pending",
  agentId: "codex",
  proposalType: "unknown_type",
  status: "pending" as const,
  rationale: "Test rationale",
  diff: { field: "value" },
  forecastWDelta: 0.12,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AgentProposalsPanel batch20", () => {
  it("shows raw proposal type label when unmapped", () => {
    mockList.mockReturnValue({ data: { proposals: [pendingProposal] }, isLoading: false, isError: false });
    render(<AgentProposalsPanel />);
    expect(screen.getByText("unknown_type")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(mutations.approve.mutate).toHaveBeenCalledWith({ id: "prop-pending" });
  });

  it("shows apply action for approved proposals", () => {
    mockList.mockReturnValue({
      data: {
        proposals: [{ ...pendingProposal, id: "prop-approved", status: "approved" }],
      },
      isLoading: false,
      isError: false,
    });
    render(<AgentProposalsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(mutations.apply.mutate).toHaveBeenCalledWith({ id: "prop-approved" });
  });
});
