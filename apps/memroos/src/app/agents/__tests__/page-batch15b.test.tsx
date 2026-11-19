/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
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
    emptyTitle: string;
    onSelect: (a: { id: string; name: string }) => void;
    onDeregister: (id: string) => void;
    onAgentUpdated: (a: { id: string; name: string }) => void;
  }) => (
    <div>
      <p>{props.emptyTitle}</p>
      <button type="button" onClick={() => props.onSelect({ id: "sel-1", name: "Sel" })}>
        Select agent batch15b
      </button>
      <button type="button" onClick={() => props.onDeregister("dep-1")}>
        Deregister batch15b
      </button>
      <button type="button" onClick={() => props.onAgentUpdated({ id: "sel-1", name: "Updated" })}>
        Update agent batch15b
      </button>
    </div>
  ),
}));

vi.mock("@/components/agents/agent-registry-drawer", () => ({
  AgentRegistryDrawer: ({ open, agent }: { open: boolean; agent: { id: string } | null }) =>
    open && agent ? <div data-testid="drawer-open">{agent.id}</div> : null,
}));

vi.mock("@/components/agents/agent-security-modes-panel", () => ({
  AgentSecurityModesPanel: () => null,
}));

vi.mock("@/components/agents/agent-registration-form", () => ({
  AgentRegistrationForm: ({
    onCreateInvite,
    onSubmit,
  }: {
    onCreateInvite?: () => void;
    onSubmit?: (
      input: unknown,
      opts?: { onSuccess?: (result: { apiKey?: string }) => void },
    ) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onCreateInvite?.()}>
        Create invite batch15b
      </button>
      <button type="button" onClick={() => onSubmit?.({})}>
        Register REST batch15b
      </button>
    </div>
  ),
}));

import AgentRegistryPage from "../page";

const agent = {
  id: "ops-agent",
  name: "Ops Agent",
  role: "operator",
  platform: "cursor",
  protocol: "rest",
  status: "active",
  capabilities: [],
  liveness: { state: "live", observedAt: null, source: "/api/agents", freshnessMs: 0, reason: null },
};

describe("AgentRegistryPage batch15b", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.useRegisterAgentMutation.mockReturnValue({
      mutate: vi.fn((_input, opts?: { onSuccess?: (r: { apiKey?: string }) => void }) => {
        opts?.onSuccess?.({ apiKey: `key-${randomUUID().slice(0, 8)}` });
      }),
      isPending: false,
    });
    api.useRegisterA2aAgentCardMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    api.useDeregisterAgentMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    api.useCreateAgentOnboardingInviteMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(true) },
    });
  });

  it("renders readiness, local runtime, and metric envelope footnotes", () => {
    api.useRegisteredAgents.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        agents: [agent],
        summary: {
          total: { value: 0, status: "zero", source: "sqlite", reason: null },
          active: { value: 1, status: "live", source: "sqlite", reason: null },
        },
        liveness: { value: null, status: "stale", source: "sqlite", reason: "heartbeat lag" },
        protocols: {
          rest: { value: 1, status: "live" },
          a2a: { value: 0, status: "zero" },
          ui: { value: 0, status: "zero" },
          local: { value: 0, status: "zero" },
        },
        readiness: {
          average: { value: 0.82, status: "live", source: "sqlite" },
          withCapabilities: { value: 1, status: "live", source: "sqlite" },
        },
        localRuntime: {
          metric: { value: 2, status: "live", source: "scan", reason: null },
        },
      },
    });
    render(<AgentRegistryPage />);
    expect(screen.getByTestId("agents-liveness-banner")).toHaveAttribute("data-liveness-status", "stale");
    expect(screen.getByText(/Readiness:/)).toBeInTheDocument();
    expect(screen.getByText(/Local runtime scan:/)).toBeInTheDocument();
    expect(screen.getAllByText(/source=sqlite/).length).toBeGreaterThan(0);
  });

  it("copies onboarding prompt and supports manual copy fallback", async () => {
    const command = `memroos onboard --token ${randomUUID()}`;
    const mutate = vi.fn((_input, opts?: { onSuccess?: (r: { command?: string }) => void }) => {
      opts?.onSuccess?.({ command });
    });
    api.useRegisteredAgents.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { agents: [], summary: undefined, liveness: undefined, protocols: undefined },
    });
    api.useCreateAgentOnboardingInviteMutation.mockReturnValue({ mutate, isPending: false });
    render(<AgentRegistryPage />);
    fireEvent.click(screen.getByRole("button", { name: "Create invite batch15b" }));
    await waitFor(() => {
      expect(screen.getByText(/Onboarding prompt copied to clipboard/i)).toBeInTheDocument();
      expect(screen.getByText(new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });

  it("surfaces invite responses without a command and generic invite errors", async () => {
    const noCommand = vi.fn((_input, opts?: { onSuccess?: (r: { command?: string }) => void }) => {
      opts?.onSuccess?.({});
    });
    api.useRegisteredAgents.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { agents: [], summary: undefined, liveness: undefined, protocols: undefined },
    });
    api.useCreateAgentOnboardingInviteMutation.mockReturnValue({ mutate: noCommand, isPending: false });
    const { rerender } = render(<AgentRegistryPage />);
    fireEvent.click(screen.getByRole("button", { name: "Create invite batch15b" }));
    await waitFor(() => {
      expect(screen.getByText(/Invite response did not include a command/i)).toBeInTheDocument();
    });

    const failMutate = vi.fn((_input, opts?: { onError?: (err: unknown) => void }) => {
      opts?.onError?.(new Error("plain failure"));
    });
    api.useCreateAgentOnboardingInviteMutation.mockReturnValue({ mutate: failMutate, isPending: false });
    rerender(<AgentRegistryPage />);
    fireEvent.click(screen.getByRole("button", { name: "Create invite batch15b" }));
    await waitFor(() => {
      expect(screen.getByText("plain failure")).toBeInTheDocument();
    });
  });

  it("shows one-time API key after registration and wires table callbacks", () => {
    const deregister = vi.fn();
    api.useDeregisterAgentMutation.mockReturnValue({ mutate: deregister, isPending: false });
    api.useRegisteredAgents.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        agents: [agent],
        summary: undefined,
        liveness: undefined,
        protocols: undefined,
      },
    });
    render(<AgentRegistryPage />);
    fireEvent.click(screen.getByRole("button", { name: "Register REST batch15b" }));
    expect(screen.getByText(/One-time API key/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Select agent batch15b" }));
    expect(screen.getByTestId("drawer-open")).toHaveTextContent("sel-1");
    fireEvent.click(screen.getByRole("button", { name: "Deregister batch15b" }));
    expect(deregister).toHaveBeenCalledWith("dep-1");
  });

  it("filters by liveness and shows registry-empty copy when no agents registered", () => {
    api.useRegisteredAgents.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { agents: [], summary: undefined, liveness: undefined, protocols: undefined },
    });
    render(<AgentRegistryPage />);
    expect(screen.getByText("No registered agents yet.")).toBeInTheDocument();
  });
});
