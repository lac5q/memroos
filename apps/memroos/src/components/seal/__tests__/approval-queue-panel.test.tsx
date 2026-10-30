import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  useSealProposals: vi.fn(),
  useApproveMutation: vi.fn(),
  useRejectMutation: vi.fn(),
  useApplyMutation: vi.fn(),
  useSealJob: vi.fn(),
  useSealJobEvidence: vi.fn(),
}));

const approveMutate = vi.fn();
const rejectMutate = vi.fn();
const applyMutate = vi.fn();

vi.mock("@/lib/api-client", () => ({
  useSealProposals: api.useSealProposals,
  useApproveMutation: () => ({ mutate: approveMutate, isPending: false, error: null }),
  useRejectMutation: () => ({ mutate: rejectMutate, isPending: false, error: null }),
  useApplyMutation: () => ({ mutate: applyMutate, isPending: false, error: null }),
  useSealJob: api.useSealJob,
  useSealJobEvidence: api.useSealJobEvidence,
}));

import { ApprovalQueuePanel } from "../approval-queue-panel";

const pendingProposal = {
  id: "p1",
  traceId: "t1",
  runId: "r1",
  agentId: "codex",
  status: "pending" as const,
  proposalType: "config_change",
  diff: { field: "weights.l1" },
  rationale: "Tune judge weights for drift guard",
  forecastWDelta: 0.02,
  baselineW: 0.91,
  baselineRunId: "br1",
  baselineLayers: {
    l1: { score: 0.9, weight: 0.4 },
    l2: { score: 0.8, weight: 0.35 },
    l3: { score: 0.7, weight: 0.25 },
  },
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

const behavioralProposal = {
  ...pendingProposal,
  id: "p2",
  status: "approved" as const,
  proposalType: "agent_instruction_patch",
  latestJobStatus: "passed" as const,
  latestJobId: "job-1",
};

describe("ApprovalQueuePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.useSealJob.mockReturnValue({
      data: { job: { id: "job-1", status: "passed", errorMessage: null } },
      isLoading: false,
    });
    api.useSealJobEvidence.mockReturnValue({
      data: {
        evidence: {
          preApplyBaselineW: 0.91,
          postApplyW: 0.93,
          toolCallTranscript: [
            { toolName: "search", denied: false, denyReason: null },
            { toolName: "write", denied: true, denyReason: "policy block" },
          ],
          rollbackHandle: "rb-1",
        },
      },
      isLoading: false,
    });
  });

  it("shows loading spinner", () => {
    api.useSealProposals.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = render(<ApprovalQueuePanel />);
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("shows empty state", () => {
    api.useSealProposals.mockReturnValue({ data: { proposals: [] }, isLoading: false });
    render(<ApprovalQueuePanel />);
    expect(screen.getByText("No proposals yet.")).toBeInTheDocument();
  });

  it("lists pending proposals and handles approve/reject/expand", () => {
    api.useSealProposals.mockReturnValue({
      data: { proposals: [pendingProposal] },
      isLoading: false,
    });
    render(<ApprovalQueuePanel />);
    expect(screen.getByText(/Tune judge weights/i)).toBeInTheDocument();
    expect(screen.getByText(/1 pending/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(approveMutate).toHaveBeenCalledWith({ id: "p1" });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(rejectMutate).toHaveBeenCalledWith({ id: "p1" });

    fireEvent.click(screen.getByRole("button", { name: "▼" }));
    expect(screen.getByText(/Diff/)).toBeInTheDocument();
  });

  it("shows apply action and behavioral evidence for approved proposals", () => {
    api.useSealProposals.mockReturnValue({
      data: { proposals: [behavioralProposal] },
      isLoading: false,
    });
    render(<ApprovalQueuePanel />);

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(applyMutate).toHaveBeenCalledWith({ id: "p2" });

    fireEvent.click(screen.getByRole("button", { name: "▼" }));
    expect(screen.getByText(/Behavioral Eval Job/)).toBeInTheDocument();
    expect(screen.getByText("search")).toBeInTheDocument();
    expect(screen.getByText(/policy block/)).toBeInTheDocument();
  });
});
