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
  useApproveMutation: () => ({ mutate: approveMutate, isPending: false, error: new Error("batch22 approve failed") }),
  useRejectMutation: () => ({ mutate: rejectMutate, isPending: false, error: null }),
  useApplyMutation: () => ({ mutate: applyMutate, isPending: false, error: null }),
  useSealJob: api.useSealJob,
  useSealJobEvidence: api.useSealJobEvidence,
}));

import { ApprovalQueuePanel } from "../approval-queue-panel";

const pendingProposal = {
  id: "p-batch22",
  traceId: "t1",
  runId: "r1",
  agentId: "codex",
  status: "pending" as const,
  proposalType: "config_change",
  diff: { field: "weights.l1" },
  rationale: "batch22 branch coverage",
  forecastWDelta: -0.01,
  baselineW: 0.91,
  baselineRunId: "br1",
  baselineLayers: {
    l1: { score: 0.9, weight: 0.4 },
    l2: { score: 0.8, weight: 0.35 },
  },
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

describe("ApprovalQueuePanel batch22", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.useSealJob.mockReturnValue({ data: undefined, isLoading: false });
    api.useSealJobEvidence.mockReturnValue({ data: undefined, isLoading: false });
  });

  it("shows mutation errors and missing baseline layer scores when expanded", () => {
    api.useSealProposals.mockReturnValue({
      data: { proposals: [pendingProposal] },
      isLoading: false,
    });

    render(<ApprovalQueuePanel />);
    expect(screen.getByText(/batch22 approve failed/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "▼" }));
    expect(screen.getByText(/l3/i)).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows polling copy while a behavioral job is running", () => {
    api.useSealProposals.mockReturnValue({
      data: {
        proposals: [
          {
            ...pendingProposal,
            id: "p-running",
            status: "approved",
            proposalType: "skill_addition",
            latestJobStatus: "running",
            latestJobId: "job-running",
          },
        ],
      },
      isLoading: false,
    });
    api.useSealJob.mockReturnValue({
      data: { job: { id: "job-running", status: "running", errorMessage: "still going" } },
      isLoading: false,
    });
    api.useSealJobEvidence.mockReturnValue({ data: { evidence: null }, isLoading: false });

    render(<ApprovalQueuePanel />);
    fireEvent.click(screen.getByRole("button", { name: "▼" }));
    expect(screen.getByText(/Polling for updates/i)).toBeInTheDocument();
    expect(screen.getByText(/still going/i)).toBeInTheDocument();
  });

  it("shows missing evidence after a completed behavioral job", () => {
    api.useSealProposals.mockReturnValue({
      data: {
        proposals: [
          {
            ...pendingProposal,
            id: "p-done",
            status: "approved",
            proposalType: "agent_instruction_patch",
            latestJobStatus: "passed",
            latestJobId: "job-done",
          },
        ],
      },
      isLoading: false,
    });
    api.useSealJob.mockReturnValue({
      data: { job: { id: "job-done", status: "passed", errorMessage: null } },
      isLoading: false,
    });
    api.useSealJobEvidence.mockReturnValue({ data: { evidence: null }, isLoading: false });

    render(<ApprovalQueuePanel />);
    fireEvent.click(screen.getByRole("button", { name: "▼" }));
    expect(screen.getByText(/Evidence not available/i)).toBeInTheDocument();
  });
});
