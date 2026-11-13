/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mutateInvite = vi.fn();

vi.mock("@/lib/api-client", () => ({
  useRegisteredAgents: vi.fn(),
  useSecurityCapabilities: vi.fn(() => ({
    data: {
      summary: { totalAgents: 0, strictAgents: 0, standardAgents: 0, permissiveAgents: 0, agentsWithSecurityCapabilities: 0 },
      policies: { defaultMode: "standard", dispatchPolicy: "enforced", a2aPolicy: "enforced", memoryWritePolicy: "enforced" },
      agents: [],
      timestamp: "",
    },
    isLoading: false,
  })),
  useRegisterAgentMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useRegisterA2aAgentCardMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useCreateAgentOnboardingInviteMutation: vi.fn(() => ({ mutate: mutateInvite, isPending: false })),
  useDeregisterAgentMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

import AgentRegistryPage from "@/app/agents/page";
import { useRegisteredAgents } from "@/lib/api-client";

describe("AgentRegistryPage batch32", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRegisteredAgents).mockReturnValue({
      data: {
        agents: [],
        timestamp: "",
        summary: {
          total: { value: 0, status: "zero", source: "/api/agents", reason: null, observedAt: null, freshnessMs: null, scope: { window: "now", workspace: "all" } },
          active: { value: 0, status: "zero", source: "/api/agents", reason: null, observedAt: null, freshnessMs: null, scope: { window: "now", workspace: "all" } },
        },
        liveness: { value: null, status: "empty", source: "heartbeat", reason: null, observedAt: null, freshnessMs: null, scope: { window: "now", workspace: "all" } },
      },
      isLoading: false,
      isError: false,
      error: null,
    } as ReturnType<typeof useRegisteredAgents>);

    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    document.execCommand = vi.fn(() => {
      throw new Error("execCommand blocked batch32");
    });
  });

  it("returns false when execCommand throws in clipboard fallback (line 68)", async () => {
    mutateInvite.mockImplementation((_input: unknown, opts: { onSuccess: (r: { command: string }) => void }) => {
      opts.onSuccess({ command: "curl batch32-fallback" });
    });

    render(<AgentRegistryPage />);
    fireEvent.click(screen.getByRole("button", { name: /Copy Invite/i }));

    await waitFor(() =>
      expect(screen.getByText(/Invite created\. Copy it from the box below/i)).toBeInTheDocument(),
    );
  });
});
