/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RegisteredAgent } from "@/types";

const mutateInvite = vi.fn();

vi.mock("@/lib/api-client", () => ({
  useRegisteredAgents: vi.fn(),
  useSecurityCapabilities: vi.fn(() => ({
    data: {
      summary: { totalAgents: 1, strictAgents: 0, standardAgents: 1, permissiveAgents: 0, agentsWithSecurityCapabilities: 0 },
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

const mockUseRegisteredAgents = vi.mocked(useRegisteredAgents);

const agentWithLiveness: RegisteredAgent & { liveness?: { state: string } } = {
  id: "live-agent",
  name: "Live Agent",
  role: "Ops",
  platform: "codex",
  protocol: "rest",
  status: "active",
  lastHeartbeat: "2026-05-05T06:00:00.000Z",
  currentTask: null,
  lessonsCount: 0,
  todayMemoryCount: 0,
  location: "local",
  isRemote: false,
  latencyMs: null,
  capabilities: [],
  metadata: {},
  host: null,
  port: null,
  healthEndpoint: null,
  tunnelUrl: null,
  createdAt: "2026-05-05T06:00:00.000Z",
  updatedAt: "2026-05-05T06:00:00.000Z",
  deregisteredAt: null,
  liveness: { state: "live" },
};

describe("AgentRegistryPage batch22b", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRegisteredAgents.mockReturnValue({
      data: {
        agents: [agentWithLiveness],
        timestamp: "",
        summary: {
          total: {
            value: 1,
            status: "live",
            source: "/api/agents",
            reason: null,
            observedAt: null,
            freshnessMs: null,
            scope: { window: "now", workspace: "all" },
          },
          active: {
            value: 1,
            status: "stale",
            source: "/api/agents",
            reason: "stale heartbeat batch22b",
            observedAt: null,
            freshnessMs: null,
            scope: { window: "now", workspace: "all" },
          },
        },
        liveness: {
          value: null,
          status: "unavailable",
          source: "heartbeat",
          reason: "no signal batch22b",
          observedAt: null,
          freshnessMs: null,
          scope: { window: "now", workspace: "all" },
        },
      },
      isLoading: false,
      isError: false,
      error: null,
    } as ReturnType<typeof useRegisteredAgents>);
  });

  it("filters by liveness and renders warn/unavailable envelope labels", () => {
    render(<AgentRegistryPage />);
    expect(screen.getByText(/no signal batch22b/i)).toBeInTheDocument();
    expect(screen.getByTitle(/stale heartbeat batch22b/i)).toBeInTheDocument();

    fireEvent.click(document.querySelector('[data-filter-value="stale"]')!);
    expect(screen.getByText(/No registered agents match this view/i)).toBeInTheDocument();

    fireEvent.click(document.querySelector('[data-filter-value="live"]')!);
    expect(screen.getByText("Live Agent")).toBeInTheDocument();
  });
});
