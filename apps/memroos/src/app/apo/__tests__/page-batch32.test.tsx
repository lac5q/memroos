/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const pageApi = vi.hoisted(() => ({
  useApo: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams({ tab: "pending" }),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, useApo: pageApi.useApo };
});

vi.mock("@/components/apo/proposal-card", () => ({
  ProposalCard: ({ proposal }: { proposal: { id: string; skill: string } }) => (
    <div data-testid={`apo-card-${proposal.id}`}>{proposal.skill}</div>
  ),
}));

vi.mock("@/components/apo/proposal-detail", () => ({
  ProposalDetail: () => null,
}));
vi.mock("@/components/apo/cycle-status", () => ({
  CycleStatus: () => null,
}));
vi.mock("@/components/apo/log-viewer", () => ({
  LogViewer: () => null,
}));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const mkProposal = (id: string, status: "pending", skill: string, ts: string) => ({
  id,
  filename: `${id}.md`,
  skill,
  subsystem: "ops",
  timestamp: ts,
  content: "# Proposal",
  status,
  tracking: { phase: status, label: status, description: "", timestamp: ts },
});

describe("ApoPage batch32", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pageApi.useApo.mockReturnValue({
      data: {
        proposals: [
          mkProposal("pend-old", "pending", "older pending", "2026-10-20T12:00:00.000Z"),
          mkProposal("pend-new", "pending", "newer pending", "2026-10-26T12:00:00.000Z"),
        ],
        stats: {
          lastRun: null,
          totalProposals: 2,
          pendingProposals: 2,
          approvedProposals: 0,
          archivedProposals: 0,
          recentLogLines: [],
        },
      },
      isLoading: false,
      error: null,
    });
  });

  it("orders same-status proposals newest-first (line 57)", async () => {
    const { default: ApoPage } = await import("../page");
    wrap(<ApoPage />);
    const cards = screen.getAllByTestId(/apo-card-pend/);
    expect(cards[0]).toHaveTextContent("newer pending");
    expect(cards[1]).toHaveTextContent("older pending");
  });
});
