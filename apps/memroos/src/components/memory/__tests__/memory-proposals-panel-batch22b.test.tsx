/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mutate = vi.fn();

vi.mock("@/lib/api-client", () => ({
  useMemoryProposals: vi.fn(),
  useMemoryProposalActionMutation: vi.fn(() => ({
    mutate,
    isPending: false,
    isError: false,
    error: null,
  })),
}));

import { MemoryProposalsPanel } from "../memory-proposals-panel";
import { useMemoryProposals } from "@/lib/api-client";

const mockUseMemoryProposals = vi.mocked(useMemoryProposals);

const proposals = [
  {
    id: "prop-pending",
    agentId: "agent-batch22b",
    proposalType: "memory_rewrite",
    status: "pending" as const,
    rationale: "pending batch22b",
    baselineW: 0.5,
    forecastWDelta: -0.01,
    createdAt: "2026-07-01T00:00:00.000Z",
    diff: { field: "salience" },
    baselineLayers: { l1: { score: 0.1 }, l2: { score: 0.2 }, l3: { score: 0.3 } },
  },
  {
    id: "prop-approved",
    agentId: "agent-batch22b",
    proposalType: "custom_type_batch22b",
    status: "approved" as const,
    rationale: "approved batch22b",
    baselineW: 0.6,
    forecastWDelta: 0.02,
    createdAt: "2026-07-02T00:00:00.000Z",
    diff: { field: "route" },
    baselineLayers: { l1: { score: 0.4 } },
  },
  {
    id: "prop-rejected",
    agentId: "agent-batch22b",
    proposalType: "eval_case_addition",
    status: "rejected" as const,
    rationale: "rejected batch22b",
    baselineW: 0.4,
    forecastWDelta: -0.03,
    createdAt: "2026-07-03T00:00:00.000Z",
    diff: { case: "x" },
    baselineLayers: {},
  },
];

describe("MemoryProposalsPanel batch22b", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseMemoryProposals.mockReturnValue({
      data: {
        proposals,
        types: {
          memory_rewrite: { label: "Rewrite" },
          custom_type_batch22b: { label: "Custom" },
        },
      },
      isLoading: false,
    } as ReturnType<typeof useMemoryProposals>);
  });

  it("orders proposals, expands diff, and triggers approve/apply actions", async () => {
    render(<MemoryProposalsPanel />);
    expect(screen.getByText(/1 pending/i)).toBeInTheDocument();
    expect(screen.getByText("Custom")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "▼" })[0]!);
    expect(screen.getByText(/"field": "salience"/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(mutate).toHaveBeenCalledWith({ id: "prop-pending", action: "approve" });

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(mutate).toHaveBeenCalledWith({ id: "prop-approved", action: "apply" });
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
  });
});
