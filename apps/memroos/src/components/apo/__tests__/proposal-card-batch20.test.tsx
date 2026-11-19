/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
  isError: false,
  error: null as Error | null,
}));

vi.mock("@/lib/api-client", () => ({
  useApproveApoProposalMutation: () => api,
}));

import { ProposalCard } from "../proposal-card";
import type { ApoProposal } from "@/types";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const base: ApoProposal = {
  id: "APO_PROPOSAL_batch20.md",
  filename: "APO_PROPOSAL_batch20.md",
  skill: "batch skill",
  subsystem: "ops",
  timestamp: "2026-10-26T12:00:00.000Z",
  content: "Plain preview text without headings",
  status: "approved",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProposalCard batch20", () => {
  it("uses fallback tracking for approved proposals without tracking block", () => {
    wrap(<ProposalCard proposal={{ ...base, tracking: undefined }} onClick={vi.fn()} />);
    expect(screen.getByText(/Queued for worker/i)).toBeInTheDocument();
  });

  it("omits target path chip when tracking has no targetPath", () => {
    wrap(
      <ProposalCard
        proposal={{
          ...base,
          status: "pending",
          tracking: {
            phase: "pending",
            label: "Awaiting",
            description: "Needs review",
            timestamp: base.timestamp,
          },
        }}
        onClick={vi.fn()}
      />,
    );
    expect(screen.queryByText(/executor:/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });
});
