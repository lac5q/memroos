import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ProposalDetail } from "../proposal-detail";

const proposal = {
  id: "APO_PROPOSAL_ops_ops_20260505_120000.md",
  filename: "APO_PROPOSAL_ops_ops_20260505_120000.md",
  skill: "ops-standup",
  subsystem: "ops",
  timestamp: "2026-05-05T12:00:00Z",
  content: "# Proposal\n\nImprove standup skill.",
  status: "pending" as const,
};

describe("ProposalDetail", () => {
  it("returns null when proposal is missing", () => {
    const { container } = render(
      <ProposalDetail proposal={null} open={false} onOpenChange={() => undefined} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders proposal content when open", () => {
    render(<ProposalDetail proposal={proposal} open onOpenChange={() => undefined} />);
    expect(screen.getByText("ops-standup")).toBeInTheDocument();
    expect(screen.getByText(/Improve standup skill/i)).toBeInTheDocument();
    expect(screen.getByText(/Awaiting review/i)).toBeInTheDocument();
  });
});
