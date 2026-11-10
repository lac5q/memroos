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

describe("AgentProposalsPanel batch32", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockReturnValue({
      data: {
        proposals: [
          {
            id: "prop-b32",
            agentId: "codex",
            proposalType: "instruction_patch",
            status: "pending",
            rationale: "batch32",
            diff: {},
            forecastWDelta: 0.1,
          },
        ],
      },
      isLoading: false,
      isError: false,
    });
  });

  it("fires reject mutation for pending proposals (line 84)", () => {
    render(<AgentProposalsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(mutations.reject.mutate).toHaveBeenCalledWith({ id: "prop-b32" });
  });
});
