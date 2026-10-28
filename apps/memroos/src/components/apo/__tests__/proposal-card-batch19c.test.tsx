/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
  isError: false,
  error: null as Error | null,
}));

vi.mock("@/lib/api-client", () => ({
  useApproveApoProposalMutation: () => ({
    mutate: api.mutate,
    isPending: api.isPending,
    isError: api.isError,
    error: api.error,
  }),
}));

import { ProposalCard } from "../proposal-card";
import type { ApoProposal } from "@/types";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const base: ApoProposal = {
  id: "APO_PROPOSAL_demo_skill_ops_20261026_120000.md",
  filename: "APO_PROPOSAL_demo_skill_ops_20261026_120000.md",
  skill: "demo skill",
  subsystem: "ops",
  timestamp: "2026-10-26T12:00:00.000Z",
  content: "# Heading\n".repeat(80),
  status: "pending",
};

beforeEach(() => {
  vi.clearAllMocks();
  api.isPending = false;
  api.isError = false;
  api.error = null;
});

describe("ProposalCard batch19c", () => {
  it("renders tracking metadata, preview ellipsis, and approve action", () => {
    const onClick = vi.fn();
    wrap(
      <ProposalCard
        proposal={{
          ...base,
          tracking: {
            phase: "pending",
            label: "Awaiting review",
            description: "Needs operator",
            timestamp: base.timestamp,
            executorCli: "codex",
            targetKind: "skill",
            applied: false,
            targetPath: "/tmp/github/knowledge/skills/demo/SKILL.md",
          },
        }}
        onClick={onClick}
      />,
    );
    expect(screen.getByText(/executor: codex/i)).toBeInTheDocument();
    expect(screen.getByText(/already present/i)).toBeInTheDocument();
    expect(screen.getByText(/…/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(api.mutate).toHaveBeenCalledWith(base.id);
    fireEvent.click(screen.getByText("demo skill"));
    expect(onClick).toHaveBeenCalled();
  });

  it("shows approval error text and archived implemented badge", () => {
    api.isError = true;
    api.error = new Error("approval rejected");
    wrap(
      <ProposalCard
        proposal={{
          ...base,
          status: "archived",
          tracking: undefined,
        }}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByText("approval rejected")).toBeInTheDocument();
    expect(screen.getByText("Implemented")).toBeInTheDocument();
  });
});
