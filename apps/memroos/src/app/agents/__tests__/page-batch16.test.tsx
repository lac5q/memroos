/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  useRegisteredAgents: vi.fn(),
  useRegisterAgentMutation: vi.fn(),
  useRegisterA2aAgentCardMutation: vi.fn(),
  useCreateAgentOnboardingInviteMutation: vi.fn(),
  useDeregisterAgentMutation: vi.fn(),
}));

vi.mock("@/lib/api-client", () => api);

vi.mock("@/components/agents/agent-registry-table", () => ({
  AgentRegistryTable: (props: {
    onSelect: (a: { id: string; name: string }) => void;
    onAgentUpdated: (a: { id: string; name: string }) => void;
  }) => (
    <div>
      <button type="button" onClick={() => props.onSelect({ id: "sel-batch16", name: "Sel Batch16" })}>
        Select batch16
      </button>
      <button type="button" onClick={() => props.onAgentUpdated({ id: "sel-batch16", name: "Updated Batch16" })}>
        Update batch16
      </button>
    </div>
  ),
}));

vi.mock("@/components/agents/agent-registry-drawer", () => ({
  AgentRegistryDrawer: ({
    open,
    agent,
    onOpenChange,
  }: {
    open: boolean;
    agent: { id: string; name: string } | null;
    onOpenChange: (open: boolean) => void;
  }) =>
    open && agent ? (
      <div data-testid="drawer-batch16">
        {agent.name}
        <button type="button" onClick={() => onOpenChange(false)}>
          Close drawer batch16
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/agents/agent-security-modes-panel", () => ({
  AgentSecurityModesPanel: () => null,
}));

vi.mock("@/components/agents/agent-registration-form", () => ({
  AgentRegistrationForm: ({ onCreateInvite }: { onCreateInvite?: (input: unknown) => void }) => (
    <button type="button" onClick={() => onCreateInvite?.({ agentId: "batch16" })}>
      Create invite batch16
    </button>
  ),
}));

import AgentRegistryPage from "../page";

describe("AgentRegistryPage batch16", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.useRegisterAgentMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    api.useRegisterA2aAgentCardMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    api.useDeregisterAgentMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    api.useCreateAgentOnboardingInviteMutation.mockReturnValue({
      mutate: vi.fn((_input, opts?: { onSuccess?: (r: { command?: string }) => void }) => {
        opts?.onSuccess?.({ command: "memroos onboard --token batch16-fallback" });
      }),
      isPending: false,
    });
    api.useRegisteredAgents.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        agents: [
          {
            id: "sel-batch16",
            name: "Sel Batch16",
            role: "ops",
            platform: "cursor",
            protocol: "rest",
            status: "active",
            liveness: { state: "live" },
          },
        ],
        summary: undefined,
        liveness: undefined,
        protocols: undefined,
      },
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    document.execCommand = vi.fn(() => true);
  });

  it("falls back to execCommand when clipboard API is unavailable", async () => {
    render(<AgentRegistryPage />);
    fireEvent.click(screen.getByRole("button", { name: "Create invite batch16" }));
    await waitFor(() => {
      expect(screen.getByText(/Onboarding prompt copied to clipboard/i)).toBeInTheDocument();
      expect(document.execCommand).toHaveBeenCalledWith("copy");
    });
  });

  it("keeps drawer selection in sync when table updates the selected agent", () => {
    render(<AgentRegistryPage />);
    fireEvent.click(screen.getByRole("button", { name: "Select batch16" }));
    expect(screen.getByTestId("drawer-batch16")).toHaveTextContent("Sel Batch16");

    fireEvent.click(screen.getByRole("button", { name: "Update batch16" }));
    expect(screen.getByTestId("drawer-batch16")).toHaveTextContent("Updated Batch16");

    fireEvent.click(screen.getByRole("button", { name: "Close drawer batch16" }));
    expect(screen.queryByTestId("drawer-batch16")).not.toBeInTheDocument();
  });
});
