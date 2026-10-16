import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const api = vi.hoisted(() => ({
  useMemoryProposals: vi.fn(),
  useMemoryProposalActionMutation: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  useMemoryProposals: api.useMemoryProposals,
  useMemoryProposalActionMutation: api.useMemoryProposalActionMutation,
}));

import { MemoryProposalsPanel } from "../memory-proposals-panel";

const sampleProposal = {
  id: "mp1",
  traceId: "t1",
  runId: "r1",
  agentId: "codex",
  status: "pending" as const,
  proposalType: "memory_rewrite",
  diff: { field: "salience" },
  rationale: "Improve recall on ops runbooks",
  forecastWDelta: 0.03,
  baselineW: 0.88,
  baselineRunId: "br1",
  baselineLayers: {
    l1: { score: 0.9, weight: 0.4 },
    l2: { score: 0.8, weight: 0.35 },
    l3: { score: 0.7, weight: 0.25 },
  },
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

describe("MemoryProposalsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.useMemoryProposalActionMutation.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
  });

  it("shows loading spinner", () => {
    api.useMemoryProposals.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = render(<MemoryProposalsPanel />);
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("shows empty state", () => {
    api.useMemoryProposals.mockReturnValue({ data: { proposals: [] }, isLoading: false });
    render(<MemoryProposalsPanel />);
    expect(screen.getByText("No memory proposals yet.")).toBeInTheDocument();
  });

  it("lists pending proposals", () => {
    api.useMemoryProposals.mockReturnValue({
      data: { proposals: [sampleProposal], types: { memory_rewrite: { label: "Rewrite" } } },
      isLoading: false,
    });
    render(<MemoryProposalsPanel />);
    expect(screen.getByText(/Improve recall on ops runbooks/i)).toBeInTheDocument();
    expect(screen.getByText(/1 pending/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });
});
