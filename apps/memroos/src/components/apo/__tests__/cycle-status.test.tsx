import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/ui/info-tip", () => ({
  InfoTip: () => null,
}));

import { CycleStatus } from "../cycle-status";

describe("CycleStatus", () => {
  it("renders APO cycle stats and stage counts", () => {
    render(
      <CycleStatus
        stats={{
          lastRun: "2026-05-20T12:00:00.000Z",
          totalProposals: 10,
          pendingProposals: 2,
          approvedProposals: 1,
          archivedProposals: 7,
          recentLogLines: [],
        }}
      />
    );

    expect(screen.getByText("Last Run")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("Needs review")).toBeInTheDocument();
    expect(screen.getByText("Approved for worker")).toBeInTheDocument();
    expect(screen.getByText("Archived history")).toBeInTheDocument();
  });

  it("shows Never when lastRun is null", () => {
    render(
      <CycleStatus
        stats={{
          lastRun: null,
          totalProposals: 0,
          pendingProposals: 0,
          approvedProposals: 0,
          archivedProposals: 0,
          recentLogLines: [],
        }}
      />
    );
    expect(screen.getByText("Never")).toBeInTheDocument();
  });
});
