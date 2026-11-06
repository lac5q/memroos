/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  return { ...actual, ...pageApi };
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

const baseProposal = {
  id: "APO_PROPOSAL_demo_skill_ops_20260505_120000.md",
  filename: "APO_PROPOSAL_demo_skill_ops_20260505_120000.md",
  skill: "demo skill",
  subsystem: "ops",
  timestamp: "2026-05-05T12:00:00.000Z",
  content: "# Proposal",
  status: "pending" as const,
  tracking: { phase: "pending", label: "Awaiting review", description: "", timestamp: "2026-05-05T12:00:00.000Z" },
};

describe("ApoPage batch15b", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.searchParams = new URLSearchParams();
    pageApi.useApo.mockReturnValue({
      data: {
        proposals: [baseProposal],
        stats: {
          lastRun: "2026-05-05T11:00:00.000Z",
          totalProposals: 1,
          pendingProposals: 1,
          approvedProposals: 0,
          archivedProposals: 0,
          recentLogLines: ["cron ok"],
        },
      },
      isLoading: false,
      error: null,
    });
  });

  it("shows pending badge counts and opens proposal detail drawer", async () => {
    const { default: ApoPage } = await import("../page");
    wrap(<ApoPage />);
    expect(screen.getByRole("heading", { name: /Improvements/i })).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "demo skill" }));
    await waitFor(() => {
      expect(screen.getByTestId("proposal-detail")).toHaveTextContent(baseProposal.id);
    });
  });

  it("shows cyan banner when proposals exist but none are pending", async () => {
    pageApi.useApo.mockReturnValue({
      data: {
        proposals: [{ ...baseProposal, status: "archived" }],
        stats: {
          lastRun: "2026-05-05T11:00:00.000Z",
          totalProposals: 2,
          pendingProposals: 0,
          approvedProposals: 0,
          archivedProposals: 2,
          recentLogLines: [],
        },
      },
      isLoading: false,
      error: null,
    });
    const { default: ApoPage } = await import("../page");
    wrap(<ApoPage />);
    expect(screen.getByText(/none are awaiting review right now/i)).toBeInTheDocument();
  });

  it("shows empty-store banner and loading/error states", async () => {
    pageApi.useApo.mockReturnValueOnce({
      data: { proposals: [], stats: { lastRun: null, totalProposals: 0, pendingProposals: 0, approvedProposals: 0, archivedProposals: 0, recentLogLines: [] } },
      isLoading: false,
      error: null,
    });
    const { default: ApoPage } = await import("../page");
    const { rerender } = wrap(<ApoPage />);
    expect(screen.getByText(/No APO proposal files were found/i)).toBeInTheDocument();

    pageApi.useApo.mockReturnValue({ data: undefined, isLoading: true, error: null });
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ApoPage />
      </QueryClientProvider>,
    );
    expect(screen.getByText(/Loading proposals/i)).toBeInTheDocument();

    pageApi.useApo.mockReturnValue({ data: undefined, isLoading: false, error: new Error("503") });
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ApoPage />
      </QueryClientProvider>,
    );
    expect(screen.getByText(/Failed to load proposals/i)).toBeInTheDocument();
  });

  it("filters archived tab and honors invalid tab query param", async () => {
    navigation.searchParams = new URLSearchParams({ tab: "not-a-tab" });
    pageApi.useApo.mockReturnValue({
      data: {
        proposals: [
          baseProposal,
          { ...baseProposal, id: "arch-1", skill: "archived skill", status: "archived" },
        ],
        stats: {
          lastRun: null,
          totalProposals: 2,
          pendingProposals: 1,
          approvedProposals: 0,
          archivedProposals: 1,
          recentLogLines: ["line-a"],
        },
      },
      isLoading: false,
      error: null,
    });
    const { default: ApoPage } = await import("../page");
    wrap(<ApoPage />);
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    expect(screen.getByRole("button", { name: "archived skill" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "demo skill" })).not.toBeInTheDocument();
    expect(screen.getByTestId("log-viewer")).toHaveTextContent("line-a");
  });
});
