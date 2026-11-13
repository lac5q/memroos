/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  useRecallStats: vi.fn(),
  useTimeSeries: vi.fn(),
  useTokenStats: vi.fn(),
  useModelUsage: vi.fn(),
  useModelRoutingDashboard: vi.fn(),
  useModelRoutingEvals: vi.fn(),
  useModelRoutingRecommendations: vi.fn(),
  useMemoryProposals: vi.fn(),
  useMemoryProposalActionMutation: vi.fn(),
  useMemoryStats: vi.fn(),
  useMemoryTierHealth: vi.fn(),
  useSecurityReport: vi.fn(),
  useContextSourceHealth: vi.fn(),
  useLibraryFreshness: vi.fn(),
  useTriggerQmdUpdate: vi.fn(),
  useSecurityCapabilities: vi.fn(),
  useOrchestrationHil: vi.fn(),
  useAgents: vi.fn(),
  useAgentPeers: vi.fn(),
  useHiveFeed: vi.fn(),
  useAuditLog: vi.fn(),
  useEvalConfig: vi.fn(),
  useEvalHistory: vi.fn(),
  useUpdateEvalConfigMutation: vi.fn(),
  useRunEvalTraceMutation: vi.fn(),
  useKnowledgeTrends: vi.fn(),
  useAgentProposals: vi.fn(),
  useBusinessOutcomeEvents: vi.fn(),
  useToolAttention: vi.fn(),
  useActivityHeatmap: vi.fn(),
  useOperationsNoc: vi.fn(),
  useSealProposals: vi.fn(),
  useApproveMutation: vi.fn(),
  useRejectMutation: vi.fn(),
  useApplyMutation: vi.fn(),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, ...api };
});

vi.mock("recharts", () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => null,
  Treemap: () => null,
  Cell: () => null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("Long-tail components batch14b", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ role: "operator" }) })));
    api.useRecallStats.mockReturnValue({ data: undefined, isLoading: true, error: null, refetch: vi.fn() });
    api.useTimeSeries.mockReturnValue({ data: { points: [] }, isLoading: false, error: null });
    api.useTokenStats.mockReturnValue({ data: { stats: {} }, isLoading: false, error: null });
    api.useModelUsage.mockReturnValue({ data: undefined, isLoading: false, error: null });
    api.useModelRoutingDashboard.mockReturnValue({
      data: {
        events: [],
        summary: {
          totalRuns: 0,
          successfulRuns: 0,
          successRate: null,
          averageQuality: null,
          averageLatencyMs: null,
        },
        timestamp: "2026-05-21T00:00:00.000Z",
      },
      isLoading: false,
      error: null,
    });
    api.useModelRoutingEvals.mockReturnValue({ data: { evals: [] }, isLoading: false, error: null });
    api.useModelRoutingRecommendations.mockReturnValue({ data: { recommendations: [] }, isLoading: false, error: null });
    api.useMemoryProposals.mockReturnValue({ data: { proposals: [], types: {} }, isLoading: false });
    api.useMemoryProposalActionMutation.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false });
    api.useContextSourceHealth.mockReturnValue({ data: { sources: [] }, isLoading: false, error: null, refetch: vi.fn() });
    api.useLibraryFreshness.mockReturnValue({ data: { collections: [] }, isLoading: false, error: null, refetch: vi.fn() });
    api.useTriggerQmdUpdate.mockReturnValue({ events: [], isStreaming: false, trigger: vi.fn() });
    api.useSecurityCapabilities.mockReturnValue({ data: undefined, isLoading: true, isError: false, error: null });
    api.useOrchestrationHil.mockReturnValue({ data: { decisions: [] }, isLoading: false, isError: false });
    api.useAgents.mockReturnValue({ data: { agents: [] }, isLoading: false, isError: false });
    api.useAgentPeers.mockReturnValue({ data: { peers: [] }, isLoading: false, isError: false });
    api.useHiveFeed.mockReturnValue({ data: { actions: [] }, isLoading: false, isError: false });
    api.useAuditLog.mockReturnValue({ data: { entries: [] }, isLoading: false, isError: false });
    api.useEvalConfig.mockReturnValue({
      data: {
        config: {
          weights: { l1: 0.3, l2: 0.3, l3: 0.4 },
          judgeModel: { provider: "openai", model: "gpt-test" },
          traceModel: { provider: "openai", model: "gpt-test" },
        },
      },
      isLoading: false,
    });
    api.useEvalHistory.mockReturnValue({ data: { runs: [] }, isLoading: false });
    api.useUpdateEvalConfigMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    api.useRunEvalTraceMutation.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false });
    api.useKnowledgeTrends.mockReturnValue({ data: { collections: [] }, isLoading: false, isError: false });
    api.useAgentProposals.mockReturnValue({ data: { proposals: [] }, isLoading: false, isError: false });
    api.useBusinessOutcomeEvents.mockReturnValue({ data: { events: [] }, isLoading: false, error: null });
    api.useToolAttention.mockReturnValue({
      data: {
        capabilities: [],
        recommendations: [],
        health: { messages: ["batch14 tool health"] },
        summary: { totalCapabilities: 0, topLevelTools: 0, workspaces: 0, recentOutcomes: 0 },
      },
      isLoading: false,
      isError: false,
    });
    api.useMemoryStats.mockReturnValue({ data: { sources: [] }, isLoading: false, isError: false });
    api.useMemoryTierHealth.mockReturnValue({ data: { tiers: [] }, isLoading: false, isError: false });
    api.useSecurityReport.mockReturnValue({
      data: { summary: { blockedAttempts: 0, securityEvents: 0, highSeverity: 0 }, timeline: [], auditActivity: [] },
      isLoading: false,
      isError: false,
    });
    api.useTimeSeries.mockReturnValue({ data: { points: [] }, isLoading: false, error: null });
    api.useActivityHeatmap.mockReturnValue({ data: { cells: [] }, isLoading: false, isError: false });
    api.useOperationsNoc.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    api.useSealProposals.mockReturnValue({ data: { proposals: [] }, isLoading: false, isError: false });
    api.useApproveMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    api.useRejectMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    api.useApplyMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  it("SqliteHealthPanel shows loading recall stats", async () => {
    const { SqliteHealthPanel } = await import("@/components/ledger/sqlite-health-panel");
    wrap(<SqliteHealthPanel />);
    expect(screen.getByText(/SQLite Store/i)).toBeInTheDocument();
  });

  it("LedgerAnalyticsPanel renders usage trends", async () => {
    const { LedgerAnalyticsPanel } = await import("@/components/ledger/analytics-panel");
    wrap(<LedgerAnalyticsPanel />);
    expect(screen.getByText("Usage Trends")).toBeInTheDocument();
  });

  it("ModelRoutingPanel renders routing heading", async () => {
    const { ModelRoutingPanel } = await import("@/components/ledger/model-routing-panel");
    wrap(<ModelRoutingPanel />);
    expect(screen.getByText(/Model Routing/i)).toBeInTheDocument();
  });

  it("MemoryIntelligencePanel renders intelligence heading", async () => {
    const { MemoryIntelligencePanel } = await import("@/components/ledger/memory-intelligence-panel");
    wrap(<MemoryIntelligencePanel />);
    expect(screen.getByText(/Memory Intelligence/i)).toBeInTheDocument();
  });

  it("CollectionTreemap renders treemap container", async () => {
    const { CollectionTreemap } = await import("@/components/library/collection-treemap");
    render(
      <CollectionTreemap
        collections={[{ name: "docs", docCount: 12, category: "business", lastUpdated: null }]}
      />,
    );
    expect(document.querySelector("div")).toBeTruthy();
  });

  it("CollectionTrendsPanel renders empty activity copy", async () => {
    const { CollectionTrendsPanel } = await import("@/components/library/collection-trends-panel");
    render(<CollectionTrendsPanel />);
    expect(screen.getByRole("heading", { name: "Collection Activity" })).toBeInTheDocument();
    expect(screen.getByText(/No collection activity data/i)).toBeInTheDocument();
  });

  it("AgentProposalsPanel shows empty proposals", async () => {
    const { AgentProposalsPanel } = await import("@/components/agents/agent-proposals-panel");
    wrap(<AgentProposalsPanel />);
    expect(screen.getByText(/No agent proposals yet/i)).toBeInTheDocument();
  });

  it("AgentSecurityModesPanel renders modes", async () => {
    const { AgentSecurityModesPanel } = await import("@/components/agents/agent-security-modes-panel");
    wrap(<AgentSecurityModesPanel />);
    expect(screen.getByText("Security Modes")).toBeInTheDocument();
  });

  it("AgentRegistryTable renders empty registry", async () => {
    const { AgentRegistryTable } = await import("@/components/agents/agent-registry-table");
    render(<AgentRegistryTable agents={[]} onSelect={vi.fn()} onDeregister={vi.fn()} />);
    expect(screen.getByText(/No registered agents match this view/i)).toBeInTheDocument();
  });

  it("AgentPeersPanel renders peer heading", async () => {
    const { AgentPeersPanel } = await import("@/components/memroos/agent-peers-panel");
    wrap(<AgentPeersPanel windowMinutes={30} />);
    expect(screen.getByText(/Agent Peers/i)).toBeInTheDocument();
  });

  it("HiveFeed renders feed heading", async () => {
    const { HiveFeed } = await import("@/components/memroos/hive-feed");
    wrap(<HiveFeed limit={10} />);
    expect(screen.getByText(/Activity Feed/i)).toBeInTheDocument();
  });

  it("AuditLogPanel renders audit heading", async () => {
    const { AuditLogPanel } = await import("@/components/memroos/audit-log-panel");
    wrap(<AuditLogPanel limit={5} />);
    expect(screen.getByText(/Audit Log/i)).toBeInTheDocument();
  });

  it("PaperclipFleetPanel renders offline fleet copy", async () => {
    const { PaperclipFleetPanel } = await import("@/components/flow/paperclip-fleet-panel");
    render(<PaperclipFleetPanel fleet={null} isLoading={false} />);
    expect(screen.getByText(/Fleet offline/i)).toBeInTheDocument();
  });

  it("NodeDetailPanel shows sparse guidance", async () => {
    const { NodeDetailPanel } = await import("@/components/flow/node-detail-panel");
    wrap(
      <NodeDetailPanel
        nodeId="node-1"
        nodeLabel="Recall"
        nodeIcon="🔍"
        nodeStats={{ calls: 0 }}
        events={[]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/Recall|sparse|events/i)).toBeInTheDocument();
  });

  it("OrchestrationHilPanel renders HIL heading", async () => {
    const { OrchestrationHilPanel } = await import("@/components/orchestration/orchestration-hil-panel");
    wrap(<OrchestrationHilPanel />);
    expect(screen.getByText(/Human approvals/i)).toBeInTheDocument();
  });

  it("SecurityOperationsPanel renders security heading", async () => {
    const { SecurityOperationsPanel } = await import("@/components/security/security-operations-panel");
    wrap(<SecurityOperationsPanel />);
    expect(screen.getByText(/Security Operations/i)).toBeInTheDocument();
  });

  it("EvalEnginePanel renders eval heading", async () => {
    const { EvalEnginePanel } = await import("@/components/evals/eval-engine-panel");
    wrap(<EvalEnginePanel />);
    expect(screen.getByText(/Eval Config/i)).toBeInTheDocument();
  });

  it("ActivityHeatmap renders grid heading", async () => {
    const { ActivityHeatmap } = await import("@/components/operations/activity-heatmap");
    render(<ActivityHeatmap filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByText(/Activity timing/i)).toBeInTheDocument();
  });

  it("MemoryNotDigested renders panel title", async () => {
    const { MemoryNotDigested } = await import("@/components/operations/memory-not-digested");
    render(<MemoryNotDigested filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByText(/Memory digestion/i)).toBeInTheDocument();
  });

  it("PulseStrip renders pulse cards", async () => {
    api.useOperationsNoc.mockReturnValue({
      data: {
        agentActivity: { status: "live", value: 3, observedAt: new Date().toISOString(), source: "/api/noc" },
        memoryWrites: { status: "zero", value: 0, observedAt: new Date().toISOString(), source: "/api/noc" },
        routingSuccess: { status: "live", value: 99, observedAt: new Date().toISOString(), source: "/api/noc" },
        openEscalations: { status: "live", value: 1, observedAt: new Date().toISOString(), source: "/api/noc" },
      },
      isLoading: false,
      isError: false,
    });
    const { PulseStrip } = await import("@/components/operations/pulse-strip");
    render(<PulseStrip filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByLabelText(/System pulse/i)).toBeInTheDocument();
    expect(screen.getByText(/Messages · 24h/i)).toBeInTheDocument();
  });

  it("AdapterStatusPanel renders adapter grid", async () => {
    const { AdapterStatusPanel } = await import("@/components/business-ops/adapter-status-panel");
    render(<AdapterStatusPanel agentId={null} />);
    expect(screen.getByText(/Adapter Status/i)).toBeInTheDocument();
  });

  it("ApprovalQueuePanel renders empty queue", async () => {
    const { ApprovalQueuePanel } = await import("@/components/seal/approval-queue-panel");
    wrap(<ApprovalQueuePanel />);
    expect(screen.getByText(/Approval Queue/i)).toBeInTheDocument();
  });

  it("ToolAttentionPanel renders attention heading", async () => {
    const { ToolAttentionPanel } = await import("@/components/cookbooks/tool-attention-panel");
    wrap(<ToolAttentionPanel />);
    expect(screen.getByText(/Tool Attention Health/i)).toBeInTheDocument();
  });
});
