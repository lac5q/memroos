/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
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

import { useMemoryProposals } from "@/lib/api-client";
import { MemoryProposalsPanel } from "../memory-proposals-panel";

const mockUseMemoryProposals = vi.mocked(useMemoryProposals);

describe("MemoryProposalsPanel batch32", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseMemoryProposals.mockReturnValue({
      data: {
        proposals: [
          {
            id: "prop-reject-b32",
            agentId: "agent-b32",
            proposalType: "memory_rewrite",
            status: "pending",
            rationale: "reject batch32",
            baselineW: 0.5,
            forecastWDelta: -0.01,
            createdAt: "2026-07-01T00:00:00.000Z",
            diff: { field: "salience" },
            baselineLayers: { l1: { score: 0.1 } },
          },
        ],
        types: { memory_rewrite: { label: "Rewrite" } },
      },
      isLoading: false,
    } as ReturnType<typeof useMemoryProposals>);
  });

  it("fires reject on pending proposals (line 103)", () => {
    render(<MemoryProposalsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(mutate).toHaveBeenCalledWith({ id: "prop-reject-b32", action: "reject" });
  });
});
