/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mutateRegister = vi.fn();
const mutateA2a = vi.fn();
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
  useRegisterAgentMutation: vi.fn(() => ({ mutate: mutateRegister, isPending: false })),
  useRegisterA2aAgentCardMutation: vi.fn(() => ({ mutate: mutateA2a, isPending: false })),
  useCreateAgentOnboardingInviteMutation: vi.fn(() => ({ mutate: mutateInvite, isPending: false })),
  useDeregisterAgentMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

import AgentRegistryPage from "@/app/agents/page";
import { useRegisteredAgents } from "@/lib/api-client";

describe("AgentRegistryPage batch23", () => {
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

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    document.execCommand = vi.fn(() => true);
  });

  it("uses execCommand fallback when clipboard API is missing", async () => {
    mutateInvite.mockImplementation((_input: unknown, opts: { onSuccess: (r: { command: string }) => void }) => {
      opts.onSuccess({ command: "curl batch23-invite" });
    });

    render(<AgentRegistryPage />);
    fireEvent.click(screen.getByRole("button", { name: /Copy Invite/i }));

    await waitFor(() => expect(screen.getByText(/Onboarding prompt copied/i)).toBeInTheDocument());
    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });

  it("stores one-time API key from A2A registration success", () => {
    mutateA2a.mockImplementation((_input: unknown, opts: { onSuccess: (r: { apiKey: string }) => void }) => {
      opts.onSuccess({ apiKey: "mk_batch23_a2a_once" });
    });

    render(<AgentRegistryPage />);
    fireEvent.click(screen.getByRole("button", { name: /Advanced/i }));
    fireEvent.click(screen.getByRole("button", { name: /A2A card URL/i }));
    fireEvent.change(screen.getByLabelText(/A2A agent-card URL/i), {
      target: { value: "http://localhost:8001/.well-known/agent-card.json" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Register A2A Agent/i }));

    expect(mutateA2a).toHaveBeenCalled();
    expect(screen.getByText("mk_batch23_a2a_once")).toBeInTheDocument();
  });
});
