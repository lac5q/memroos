/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const navigation = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
}));

const pageApi = vi.hoisted(() => ({
  useApo: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => navigation.searchParams,
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, useApo: pageApi.useApo };
});

vi.mock("@/components/apo/proposal-card", () => ({
  ProposalCard: ({ proposal, onClick }: { proposal: { id: string; skill: string }; onClick: (p: unknown) => void }) => (
    <button type="button" onClick={() => onClick(proposal)}>
      {proposal.skill}
    </button>
  ),
}));

vi.mock("@/components/apo/proposal-detail", () => ({
  ProposalDetail: ({ open, proposal }: { open: boolean; proposal: { id: string } | null }) =>
    open && proposal ? <div data-testid="proposal-detail">{proposal.id}</div> : null,
}));

vi.mock("@/components/apo/cycle-status", () => ({
  CycleStatus: () => <div data-testid="cycle-status" />,
}));

vi.mock("@/components/apo/log-viewer", () => ({
  LogViewer: ({ lines }: { lines: string[] }) => <pre data-testid="log-viewer">{lines.join("\n")}</pre>,
}));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const mkProposal = (id: string, status: "pending" | "approved" | "archived", skill: string, ts: string) => ({
  id,
  filename: `${id}.md`,
  skill,
  subsystem: "ops",
  timestamp: ts,
  content: "# Proposal",
  status,
  tracking: { phase: status, label: status, description: "", timestamp: ts },
});

describe("ApoPage batch19c", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.searchParams = new URLSearchParams({ tab: "all" });
    pageApi.useApo.mockReturnValue({
      data: {
        proposals: [
          mkProposal("arch-old", "archived", "old archived", "2026-10-20T12:00:00.000Z"),
          mkProposal("appr-new", "approved", "queued skill", "2026-10-26T12:00:00.000Z"),
          mkProposal("pend-new", "pending", "pending skill", "2026-10-25T12:00:00.000Z"),
        ],
        stats: {
          lastRun: "2026-10-26T11:00:00.000Z",
          totalProposals: 2,
          pendingProposals: 0,
          approvedProposals: 1,
          archivedProposals: 1,
          recentLogLines: ["worker idle"],
        },
      },
      isLoading: false,
      error: null,
    });
  });

  it("sorts all-tab proposals with pending first, then queued, then archived", async () => {
    const { default: ApoPage } = await import("../page");
    wrap(<ApoPage />);
    const buttons = screen.getAllByRole("button").map((el) => el.textContent);
    const pendingIndex = buttons.findIndex((text) => text === "pending skill");
    const queuedIndex = buttons.findIndex((text) => text === "queued skill");
    const archivedIndex = buttons.findIndex((text) => text === "old archived");
    expect(pendingIndex).toBeLessThan(queuedIndex);
    expect(queuedIndex).toBeLessThan(archivedIndex);
    fireEvent.click(screen.getByRole("button", { name: "queued skill" }));
    expect(screen.getByTestId("proposal-detail")).toHaveTextContent("appr-new");
  });
});
