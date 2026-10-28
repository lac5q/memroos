import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const api = vi.hoisted(() => ({
  useSealProposals: vi.fn(),
  useSealAuditLog: vi.fn(),
  useApproveMutation: vi.fn(),
  useRejectMutation: vi.fn(),
  useApplyMutation: vi.fn(),
  useSealJob: vi.fn(),
  useSealJobEvidence: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  useSealProposals: api.useSealProposals,
  useSealAuditLog: api.useSealAuditLog,
  useApproveMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useRejectMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useApplyMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useSealJob: api.useSealJob,
  useSealJobEvidence: api.useSealJobEvidence,
}));

import SealPage from "../page";

describe("SealPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.useSealJob.mockReturnValue({ data: undefined, isLoading: false });
    api.useSealJobEvidence.mockReturnValue({ data: undefined, isLoading: false });
    api.useSealProposals.mockReturnValue({ data: { proposals: [] }, isLoading: false });
    api.useSealAuditLog.mockReturnValue({ data: { entries: [] }, isLoading: false });
  });

  it("renders SEAL header and panels", () => {
    render(<SealPage />);
    expect(screen.getByRole("heading", { name: "SEAL" })).toBeInTheDocument();
    expect(screen.getByText("Audit Log")).toBeInTheDocument();
    expect(screen.getByText("No proposals yet.")).toBeInTheDocument();
  });
});
