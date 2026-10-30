/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/flow",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    useAgents: vi.fn(() => ({ data: { agents: [] }, isLoading: false })),
    useDelegations: vi.fn(() => ({ data: { delegations: [] }, isLoading: false })),
    useHiveFeed: vi.fn(() => ({ data: { actions: [] }, isLoading: false, isError: false })),
    useModelRoutingDashboard: vi.fn(() => ({ data: { events: [] }, isLoading: false, isError: false })),
    useModelUsage: vi.fn(() => ({
      data: { usage: { models: [], total: { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreation: 0, requests: 0 } } },
      isLoading: false,
      isError: false,
    })),
    useSkills: vi.fn(() => ({ data: { skillBudget: { duplicateSkills: [] }, coverageGaps: [] }, isLoading: false, isError: false })),
    useRegisteredAgents: vi.fn(() => ({ data: { agents: [] }, isLoading: false })),
    useBusinessOutcomeEvents: vi.fn(() => ({ data: { events: [] }, isLoading: false })),
    useOperationsNoc: vi.fn(() => ({
      data: {
        agentActivity: { observedAt: null, source: "sqlite://messages" },
        modelUsage: { value: 0, status: "empty", source: "/api/model-usage", observedAt: null, freshnessMs: null, scope: { window: "24h", workspace: "all" }, reason: null },
      },
      isLoading: false,
      isError: false,
    })),
    useCronHealth: vi.fn(() => ({ data: { jobs: [] }, isLoading: false, isError: false })),
    useMemoryWriteTiming: vi.fn(() => ({ data: { points: [] }, isLoading: false, isError: false })),
    useSkillRegistrySummary: vi.fn(() => ({
      data: { enabled: { value: 0, status: "empty", source: "skills", observedAt: null, freshnessMs: null, scope: { window: "now", workspace: "all" }, reason: null } },
      isLoading: false,
      isError: false,
    })),
    useMemoryProposals: vi.fn(() => ({ data: { proposals: [] }, isLoading: false })),
    useSecurityCapabilities: vi.fn(() => ({
      data: {
        summary: { totalAgents: 0, strictAgents: 0, standardAgents: 0, permissiveAgents: 0, agentsWithSecurityCapabilities: 0 },
        policies: { defaultMode: "standard", dispatchPolicy: "enforced", a2aPolicy: "enforced", memoryWritePolicy: "enforced" },
        agents: [],
        timestamp: "",
      },
      isLoading: false,
    })),
    useSecurityReport: vi.fn(() => ({ data: { findings: [] }, isLoading: false })),
  };
});

vi.mock("recharts", () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => null,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: () => null,
  Cell: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe("Long-tail components batch23", () => {
  beforeEach(() => vi.clearAllMocks());

  it("pulse strip renders system pulse region", async () => {
    const { PulseStrip } = await import("@/components/operations/pulse-strip");
    wrap(<PulseStrip filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByLabelText("System pulse")).toBeInTheDocument();
  });

  it("dispatch panel blocks empty dispatch submits", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { DispatchPanel } = await import("@/components/dispatch/dispatch-panel");
    render(<DispatchPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Dispatch/i }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("adapter status panel renders heading", async () => {
    const { AdapterStatusPanel } = await import("@/components/business-ops/adapter-status-panel");
    render(<AdapterStatusPanel />);
    expect(screen.getByText(/Adapter status/i)).toBeInTheDocument();
  });

  it("agent liveness badge renders stale label", async () => {
    const { AgentLivenessBadge } = await import("@/components/agents/agent-liveness-badge");
    render(
      <AgentLivenessBadge
        observation={{ state: "stale", reason: "heartbeat batch23 stale", observedAt: null, source: "heartbeat" }}
      />,
    );
    expect(screen.getByText(/stale/i)).toBeInTheDocument();
  });

  it("model mix chart renders empty-state copy", async () => {
    const { ModelMixChart } = await import("@/components/ledger/model-mix-chart");
    render(<ModelMixChart data={[]} />);
    expect(screen.getByText(/No model usage/i)).toBeInTheDocument();
  });

  it("savings chart renders empty-state copy", async () => {
    const { SavingsChart } = await import("@/components/ledger/savings-chart");
    render(<SavingsChart data={[]} />);
    expect(screen.getByText(/No per-command savings/i)).toBeInTheDocument();
  });

  it("time series chart renders heading", async () => {
    const { TimeSeriesChart } = await import("@/components/shared/time-series-chart");
    render(<TimeSeriesChart title="Batch23 series" points={[]} />);
    expect(screen.getByText("Batch23 series")).toBeInTheDocument();
  });

  it("paperclip fleet panel renders offline copy", async () => {
    const { PaperclipFleetPanel } = await import("@/components/flow/paperclip-fleet-panel");
    render(<PaperclipFleetPanel fleet={null} isLoading={false} />);
    expect(screen.getByText(/Fleet offline/i)).toBeInTheDocument();
  });

  it("memory proposals panel renders empty proposals copy", async () => {
    const { MemoryProposalsPanel } = await import("@/components/memory/memory-proposals-panel");
    render(<MemoryProposalsPanel />);
    expect(screen.getByText(/No memory proposals yet/i)).toBeInTheDocument();
  });

  it("agent security modes panel renders policy heading", async () => {
    const { AgentSecurityModesPanel } = await import("@/components/agents/agent-security-modes-panel");
    render(<AgentSecurityModesPanel />);
    expect(screen.getByText(/Security Modes/i)).toBeInTheDocument();
  });

  it("security operations panel renders heading", async () => {
    const { SecurityOperationsPanel } = await import("@/components/security/security-operations-panel");
    render(<SecurityOperationsPanel />);
    expect(screen.getByText(/Security operations/i)).toBeInTheDocument();
  });

  it("proposal card renders title", async () => {
    const { ProposalCard } = await import("@/components/apo/proposal-card");
    wrap(
      <ProposalCard
        onClick={() => undefined}
        proposal={{
          id: "prop-batch23",
          skill: "Batch23 proposal",
          subsystem: "skills",
          status: "pending",
          timestamp: "2026-07-01T00:00:00.000Z",
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z",
          targetPath: "skills/example/SKILL.md",
          content: "# Batch23 proposal\n\nBody",
          rationale: "batch23 rationale",
          diffPreview: "+ batch23",
          tracking: { status: "pending", reviewedAt: null, reviewedBy: null, notes: null },
        }}
      />,
    );
    expect(screen.getByText("Batch23 proposal")).toBeInTheDocument();
  });

  it("noc header renders operations label", async () => {
    const { NocHeader } = await import("@/components/operations/noc-header");
    render(<NocHeader filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByText(/Operations/i)).toBeInTheDocument();
  });

  it("agent drawer renders selected agent label", async () => {
    const { AgentDrawer } = await import("@/components/memroos/agent-drawer");
    render(
      <AgentDrawer
        open
        agent={{
          id: "drawer-batch23",
          name: "Drawer Batch23",
          role: "Ops",
          platform: "codex",
          protocol: "local",
          status: "active",
          lastHeartbeat: null,
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
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z",
          deregisteredAt: null,
        }}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText("Drawer Batch23")).toBeInTheDocument();
  });

  it("dispatch panel shows delegations heading", async () => {
    const { DispatchPanel } = await import("@/components/dispatch/dispatch-panel");
    render(<DispatchPanel />);
    expect(screen.getByText(/Live Delegations/i)).toBeInTheDocument();
  });
});
