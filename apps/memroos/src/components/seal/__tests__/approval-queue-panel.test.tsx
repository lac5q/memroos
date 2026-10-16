import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const api = vi.hoisted(() => ({
  useSealProposals: vi.fn(),
  useApproveMutation: vi.fn(),
  useRejectMutation: vi.fn(),
  useApplyMutation: vi.fn(),
  useSealJob: vi.fn(),
  useSealJobEvidence: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  useSealProposals: api.useSealProposals,
  useApproveMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useRejectMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useApplyMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useSealJob: api.useSealJob,
  useSealJobEvidence: api.useSealJobEvidence,
}));

import { ApprovalQueuePanel } from "../approval-queue-panel";

describe("ApprovalQueuePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.useSealJob.mockReturnValue({ data: undefined, isLoading: false });
    api.useSealJobEvidence.mockReturnValue({ data: undefined, isLoading: false });
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

  it("lists pending proposals first", () => {
    api.useSealProposals.mockReturnValue({
      data: {
        proposals: [
          {
            id: "p1",
            traceId: "t1",
            runId: "r1",
            agentId: "codex",
            status: "pending",
            proposalType: "config_change",
            diff: {},
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
          },
        ],
      },
      isLoading: false,
    });
    render(<ApprovalQueuePanel />);
    expect(screen.getByText(/Tune judge weights/i)).toBeInTheDocument();
    expect(screen.getByText(/1 pending/)).toBeInTheDocument();
  });
});
