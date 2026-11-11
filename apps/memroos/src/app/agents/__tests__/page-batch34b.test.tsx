/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RegisteredAgent } from "@/types";

const mutateInvite = vi.fn();
const mutateRegister = vi.fn();

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
  useRegisterAgentMutation: vi.fn(() => ({ mutate: mutateRegister, isPending: false })),
  useRegisterA2aAgentCardMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useCreateAgentOnboardingInviteMutation: vi.fn(() => ({ mutate: mutateInvite, isPending: false })),
  useDeregisterAgentMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

import AgentRegistryPage from "@/app/agents/page";
import { useRegisteredAgents } from "@/lib/api-client";

const agentRow: RegisteredAgent & { liveness?: { state: string } } = {
  id: "batch34b-agent",
  name: "Batch34b Agent",
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

describe("AgentRegistryPage batch34b", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRegisteredAgents).mockReturnValue({
      data: {
        agents: [agentRow],
        timestamp: "",
        summary: {
          total: { value: 1, status: "stale", source: "/api/agents", reason: "stale", observedAt: null, freshnessMs: null, scope: { window: "now", workspace: "all" } },
          active: { value: 1, status: "degraded", source: "/api/agents", reason: "warn", observedAt: null, freshnessMs: null, scope: { window: "now", workspace: "all" } },
        },
        liveness: { value: 2, status: "live", source: "heartbeat", reason: null, observedAt: "2026-07-01T00:00:00.000Z", freshnessMs: 0, scope: { window: "now", workspace: "all" } },
        readiness: {
          average: { value: 0.8, status: "live", source: "registry", reason: null, observedAt: null, freshnessMs: null, scope: { window: "now", workspace: "all" } },
          withCapabilities: { value: 1, status: "live", source: "registry", reason: null, observedAt: null, freshnessMs: null, scope: { window: "now", workspace: "all" } },
        },
        localRuntime: {
          metric: { value: 3, status: "live", source: "cli", reason: "sessions ok", observedAt: null, freshnessMs: null, scope: { window: "now", workspace: "all" } },
        },
      },
      isLoading: false,
      isError: false,
      error: null,
    } as ReturnType<typeof useRegisteredAgents>);
  });

  it("maps invite registry auth errors (lines 27–28)", async () => {
    mutateInvite.mockImplementation((_input: unknown, opts: { onError: (err: Error) => void }) => {
      opts.onError(new Error("Registry write authorization required for invite"));
    });
    render(<AgentRegistryPage />);
    fireEvent.click(screen.getByRole("button", { name: /Copy Invite/i }));
    expect(await screen.findByText(/Operator key required/i)).toBeInTheDocument();
  });

  it("renders liveness, readiness, and local runtime banners (lines 187, 218)", () => {
    render(<AgentRegistryPage />);
    expect(screen.getByTestId("agents-liveness-banner")).toHaveTextContent(/\(2 active\)/);
    expect(screen.getByText(/sessions ok/)).toBeInTheDocument();
    expect(screen.getByText(/Readiness/i)).toBeInTheDocument();
  });

  it("shows envelope dash labels for unavailable stats (line 85)", () => {
    vi.mocked(useRegisteredAgents).mockReturnValue({
      data: {
        agents: [],
        timestamp: "",
        summary: {
          total: { value: null, status: "unavailable", source: "/api/agents", reason: "down", observedAt: null, freshnessMs: null, scope: { window: "now", workspace: "all" } },
          active: { value: null, status: "blocked", source: "/api/agents", reason: null, observedAt: null, freshnessMs: null, scope: { window: "now", workspace: "all" } },
        },
        liveness: { value: null, status: "unavailable", source: "heartbeat", reason: null, observedAt: null, freshnessMs: null, scope: { window: "now", workspace: "all" } },
      },
      isLoading: false,
      isError: false,
      error: null,
    } as ReturnType<typeof useRegisteredAgents>);
    render(<AgentRegistryPage />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders load error messaging (line 368)", () => {
    vi.mocked(useRegisteredAgents).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("agents db locked"),
    } as ReturnType<typeof useRegisteredAgents>);
    render(<AgentRegistryPage />);
    expect(screen.getByText(/Failed to load \/api\/agents/i)).toHaveTextContent(/agents db locked/);
  });
});
