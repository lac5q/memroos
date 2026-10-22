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
  AgentRegistryTable: ({
    emptyTitle,
    emptyReason,
  }: {
    emptyTitle: string;
    emptyReason: string;
  }) => (
    <div>
      <p>{emptyTitle}</p>
      <p>{emptyReason}</p>
    </div>
  ),
}));

vi.mock("@/components/agents/agent-registry-drawer", () => ({
  AgentRegistryDrawer: () => null,
}));

vi.mock("@/components/agents/agent-security-modes-panel", () => ({
  AgentSecurityModesPanel: () => <div data-testid="security-modes" />,
}));

vi.mock("@/components/agents/agent-registration-form", () => ({
  AgentRegistrationForm: ({
    onCreateInvite,
  }: {
    onCreateInvite?: () => void;
  }) => (
    <button type="button" onClick={() => onCreateInvite?.()}>
      Trigger invite batch13b
    </button>
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

describe("AgentRegistryPage batch13b", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.useRegisterAgentMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    api.useRegisterA2aAgentCardMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    api.useDeregisterAgentMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    api.useCreateAgentOnboardingInviteMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  it("shows loading and error banners", () => {
    api.useRegisteredAgents.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    const { rerender } = render(<AgentRegistryPage />);
    expect(document.querySelector(".animate-spin")).toBeTruthy();

    api.useRegisteredAgents.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error("503"),
      data: undefined,
    });
    rerender(<AgentRegistryPage />);
    expect(screen.getByText(/Failed to load \/api\/agents/i)).toBeInTheDocument();
    expect(screen.getByText(/503/)).toBeInTheDocument();
  });

  it("renders liveness banner and filter-empty copy", () => {
    api.useRegisteredAgents.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        agents: [agent],
        summary: {
          total: { value: 1, status: "live", source: "sqlite", reason: null },
          active: { value: 1, status: "live", source: "sqlite", reason: null },
        },
        liveness: { value: 1, status: "live", source: "sqlite", reason: "measured" },
        protocols: {
          rest: { value: 1, status: "live" },
          a2a: { value: 0, status: "zero" },
          ui: { value: 0, status: "zero" },
          local: { value: 0, status: "zero" },
        },
      },
    });
    render(<AgentRegistryPage />);
    expect(screen.getByTestId("agents-liveness-banner")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "dormant", exact: true }));
    expect(screen.getByText("No registered agents match this view.")).toBeInTheDocument();
  });

  it("maps invite operator-key failures to operator guidance", async () => {
    const mutate = vi.fn((_input, opts?: { onError?: (err: Error) => void }) => {
      opts?.onError?.(new Error("Registry write authorization required for invite"));
    });
    api.useRegisteredAgents.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { agents: [], summary: undefined, liveness: undefined, protocols: undefined },
    });
    api.useCreateAgentOnboardingInviteMutation.mockReturnValue({ mutate, isPending: false });
    render(<AgentRegistryPage />);
    fireEvent.click(screen.getByRole("button", { name: "Trigger invite batch13b" }));
    await waitFor(() => {
      expect(screen.getByText(/Operator key required/i)).toBeInTheDocument();
    });
  });
});
