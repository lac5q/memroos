import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const api = vi.hoisted(() => ({
  useMemoryProposals: vi.fn(),
  useMemoryProposalActionMutation: vi.fn(),
  useRunPolicyLabMutation: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  useMemoryProposals: api.useMemoryProposals,
  useMemoryProposalActionMutation: api.useMemoryProposalActionMutation,
  useRunPolicyLabMutation: api.useRunPolicyLabMutation,
}));

import MemoryAutogenPage from "../page";

describe("MemoryAutogenPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.useMemoryProposals.mockReturnValue({ data: { proposals: [] }, isLoading: false });
    api.useMemoryProposalActionMutation.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    api.useRunPolicyLabMutation.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      data: undefined,
    });
  });

  it("renders memory autogen sections", () => {
    render(<MemoryAutogenPage />);
    expect(screen.getByRole("heading", { name: "Memory" })).toBeInTheDocument();
    expect(screen.getByText("Memory Proposals")).toBeInTheDocument();
    expect(screen.getByText("Memory Policy Lab")).toBeInTheDocument();
  });
});
