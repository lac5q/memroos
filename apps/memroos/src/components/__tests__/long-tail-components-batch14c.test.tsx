/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RegisteredAgent } from "@/types";

const api = vi.hoisted(() => ({
  useUpdateAgentDetailsMutation: vi.fn(),
  useBusinessOutcomeEvents: vi.fn(),
  useToolAttention: vi.fn(),
  useAgents: vi.fn(),
  useDelegations: vi.fn(),
  useOrchestrationHil: vi.fn(),
  useResolveOrchestrationHilMutation: vi.fn(),
  useSealProposals: vi.fn(),
  useApproveMutation: vi.fn(),
  useRejectMutation: vi.fn(),
  useApplyMutation: vi.fn(),
  useSealJob: vi.fn(),
  useSealJobEvidence: vi.fn(),
  useEvalHistory: vi.fn(),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, ...api };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

vi.mock("@/components/dispatch/lineage-drawer", () => ({
  LineageDrawer: () => <div data-testid="lineage-drawer" />,
}));

vi.mock("@/components/orchestration/HilEditPanel", () => ({
  HilEditPanel: () => <div data-testid="hil-edit-panel" />,
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      onMouseEnter,
      onMouseLeave,
      className,
    }: {
      children: React.ReactNode;
      onMouseEnter?: () => void;
      onMouseLeave?: () => void;
      className?: string;
    }) => (
      <div className={className} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
        {children}
      </div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("recharts", () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
  Line: ({ name }: { name?: string }) => <div data-testid={`line-${name ?? "anon"}`} />,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function baseAgent(overrides: Partial<RegisteredAgent> = {}): RegisteredAgent {
  return {
    id: "agent-14c",
    name: "Batch14c Agent",
    role: "Coverage helper",
    platform: "cursor",
    status: "active",
    protocol: "rest",
    capabilities: [
      { id: "c1", name: "read", description: "read", tags: [] },
      { id: "c2", name: "write", description: "write", tags: [] },
      { id: "c3", name: "extra", description: "extra", tags: [] },
    ],
    metadata: { a2a: { source: "adk" } },
    host: "localhost",
    port: 8080,
    healthEndpoint: "/health",
    tunnelUrl: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deregisteredAt: null,
    lastHeartbeat: null,
    currentTask: null,
    lessonsCount: 0,
    todayMemoryCount: 0,
    ...overrides,
  };
}

describe("Long-tail components batch14c", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    api.useUpdateAgentDetailsMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    api.useBusinessOutcomeEvents.mockReturnValue({ data: { events: [], timestamp: new Date().toISOString() }, isLoading: false, error: null });
    api.useToolAttention.mockReturnValue({
      data: {
        capabilities: [],
        recommendations: [],
        health: { messages: [] },
        summary: { totalCapabilities: 0, topLevelTools: 0, workspaces: 0, recentOutcomes: 0 },
      },
      isLoading: false,
      isError: false,
    });
    api.useAgents.mockReturnValue({ data: { agents: [] }, isLoading: false, isError: false });
    api.useDelegations.mockReturnValue({ data: { delegations: [] }, isLoading: false, isError: false, refetch: vi.fn() });
    api.useOrchestrationHil.mockReturnValue({ data: { decisions: [] }, isLoading: false, isError: false });
    api.useResolveOrchestrationHilMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    api.useSealProposals.mockReturnValue({ data: { proposals: [] }, isLoading: false, isError: false });
    api.useApproveMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    api.useRejectMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    api.useApplyMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    api.useSealJob.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    api.useSealJobEvidence.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    api.useEvalHistory.mockReturnValue({ data: { runs: [] }, isLoading: false, isError: false });
  });

  it("AgentRegistryTable shows never heartbeat and ADK badge", async () => {
    const { AgentRegistryTable } = await import("@/components/agents/agent-registry-table");
    render(
      <AgentRegistryTable
        agents={[baseAgent()]}
        onSelect={vi.fn()}
        onDeregister={vi.fn()}
      />,
    );
    expect(screen.getByText("never")).toBeInTheDocument();
    expect(screen.getByText("ADK")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
  });

  it("AgentRegistryTable inline editor surfaces non-Error save failures", async () => {
    const mutate = vi.fn((_payload, opts: { onError?: (e: unknown) => void }) => {
      opts.onError?.("network down");
    });
    api.useUpdateAgentDetailsMutation.mockReturnValue({ mutate, isPending: false });
    const { AgentRegistryTable } = await import("@/components/agents/agent-registry-table");
    render(
      <AgentRegistryTable
        agents={[baseAgent()]}
        onSelect={vi.fn()}
        onDeregister={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("edit-agent-agent-14c"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Save failed")).toBeInTheDocument();
  });

  it("AgentRegistryTable saves renamed agent on success", async () => {
    const onAgentUpdated = vi.fn();
    const mutate = vi.fn((_payload, opts: { onSuccess?: (r: { agent: RegisteredAgent }) => void }) => {
      opts.onSuccess?.({ agent: baseAgent({ name: "Renamed" }) });
    });
    api.useUpdateAgentDetailsMutation.mockReturnValue({ mutate, isPending: false });
    const { AgentRegistryTable } = await import("@/components/agents/agent-registry-table");
    render(
      <AgentRegistryTable
        agents={[baseAgent()]}
        onSelect={vi.fn()}
        onDeregister={vi.fn()}
        onAgentUpdated={onAgentUpdated}
      />,
    );
    fireEvent.click(screen.getByTestId("edit-agent-agent-14c"));
    fireEvent.change(screen.getByLabelText("Agent name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onAgentUpdated).toHaveBeenCalledWith(expect.objectContaining({ name: "Renamed" }));
  });

  it("AdapterStatusPanel renders events for wired adapters", async () => {
    api.useBusinessOutcomeEvents.mockReturnValue({
      data: {
        events: [{ adapter: "hubspot", polledAt: "2026-05-01T12:00:00.000Z", outcome: "ok" }],
        timestamp: "2026-05-01T12:00:00.000Z",
      },
      isLoading: false,
      error: null,
    });
    const { AdapterStatusPanel } = await import("@/components/business-ops/adapter-status-panel");
    render(<AdapterStatusPanel agentId="agent-14c" dateRange={{ since: "2026-04-01T00:00:00.000Z" }} />);
    expect(screen.getByText(/events: live/i)).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("ToolAttentionPanel renders candidate and unknown status styles", async () => {
    api.useToolAttention.mockReturnValue({
      data: {
        capabilities: [
          {
            name: "alpha-tool",
            description: "Alpha",
            type: "mcp",
            status: "candidate",
            topLevel: true,
            outcomeSummary: { score: 0.8, uses: 2 },
          },
          {
            name: "beta-tool",
            description: "Beta",
            type: "cli",
            status: "deprecated",
            topLevel: false,
          },
        ],
        recommendations: [],
        health: { messages: [] },
        summary: { totalCapabilities: 2, topLevelTools: 1, workspaces: 1, recentOutcomes: 1 },
      },
      isLoading: false,
      isError: false,
    });
    const { ToolAttentionPanel } = await import("@/components/cookbooks/tool-attention-panel");
    wrap(<ToolAttentionPanel />);
    expect(screen.getByText("candidate")).toBeInTheDocument();
    expect(screen.getByText("deprecated")).toBeInTheDocument();
    expect(screen.getByText(/score 0.8/i)).toBeInTheDocument();
  });

  it("DispatchPanel ignores dispatch when agent or summary missing", async () => {
    const { DispatchPanel } = await import("@/components/dispatch/dispatch-panel");
    wrap(<DispatchPanel />);
    const dispatchBtn = screen.getByRole("button", { name: "Dispatch" });
    expect(dispatchBtn).toBeDisabled();
    fireEvent.click(dispatchBtn);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("DispatchPanel posts dispatch and clears notice on edit", async () => {
    api.useAgents.mockReturnValue({
      data: {
        agents: [
          {
            id: "target-agent",
            name: "Target",
            role: "Worker",
            platform: "unknown-platform",
            status: "active",
          },
        ],
      },
      isLoading: false,
      isError: false,
    });
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ mode: "queued" }),
    } as Response);
    const { DispatchPanel } = await import("@/components/dispatch/dispatch-panel");
    wrap(<DispatchPanel />);
    const [agentSelect, prioritySelect] = screen.getAllByRole("combobox");
    fireEvent.change(agentSelect!, { target: { value: "target-agent" } });
    fireEvent.change(prioritySelect, { target: { value: "3" } });
    fireEvent.change(screen.getByPlaceholderText("Task summary…"), { target: { value: "Run batch14c dispatch" } });
    fireEvent.click(screen.getByRole("button", { name: "Dispatch" }));
    await waitFor(() => {
      expect(screen.getByText(/Queued in Hive/i)).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText("Task summary…"), { target: { value: "Run batch14c dispatch!" } });
    expect(screen.queryByText(/Queued in Hive/i)).not.toBeInTheDocument();
  });

  it("ActivityFeed renders empty copy", async () => {
    const { ActivityFeed } = await import("@/components/flow/activity-feed");
    render(<ActivityFeed events={[]} />);
    expect(screen.getByText(/No recent activity detected/i)).toBeInTheDocument();
  });

  it("ActivityFeed handles hover callbacks and hour labels", async () => {
    const onNodeHover = vi.fn();
    const old = Date.now;
    Date.now = () => new Date("2026-05-01T14:00:00.000Z").getTime();
    const { ActivityFeed } = await import("@/components/flow/activity-feed");
    render(
      <ActivityFeed
        events={[
          {
            id: "e1",
            timestamp: "2026-05-01T13:30:00.000Z",
            node: "recall",
            type: "custom",
            message: "Batch14c event",
            severity: "info",
          },
        ]}
        highlightedNode="recall"
        onNodeHover={onNodeHover}
      />,
    );
    expect(screen.getByText(/m ago|just now/i)).toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByText("Batch14c event").closest("div")!);
    fireEvent.mouseLeave(screen.getByText("Batch14c event").closest("div")!);
    expect(onNodeHover).toHaveBeenCalledWith("recall");
    expect(onNodeHover).toHaveBeenCalledWith(null);
    Date.now = old;
  });

  it("OrchestrationHilPanel rejects a pending decision", async () => {
    const mutate = vi.fn();
    api.useOrchestrationHil.mockReturnValue({
      data: {
        decisions: [
          {
            id: "dec-14c",
            taskSummary: "Approve routing change",
            correlationId: "corr-14c",
            selectedAgentId: "agent-14c",
          },
        ],
      },
      isLoading: false,
      isError: false,
    });
    api.useResolveOrchestrationHilMutation.mockReturnValue({ mutate, isPending: false });
    const { OrchestrationHilPanel } = await import("@/components/orchestration/orchestration-hil-panel");
    wrap(<OrchestrationHilPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(mutate).toHaveBeenCalledWith({ id: "dec-14c", decision: "reject" });
  });

  it("ApprovalQueuePanel EvidenceView shows loading job state", async () => {
    api.useSealProposals.mockReturnValue({
      data: {
        proposals: [
          {
            id: "prop-14c",
            traceId: "trace-14c",
            runId: "run-14c",
            agentId: "agent-14c",
            proposalType: "agent_instruction_patch",
            status: "pending",
            diff: { instruction: "batch14c" },
            rationale: "test behavioral patch",
            forecastWDelta: 0.01,
            baselineW: 0.9,
            baselineRunId: "br-14c",
            baselineLayers: {
              l1: { score: 0.9, weight: 0.4 },
              l2: { score: 0.8, weight: 0.35 },
              l3: { score: 0.7, weight: 0.25 },
            },
            createdAt: "2026-05-01T00:00:00.000Z",
            updatedAt: "2026-05-01T00:00:00.000Z",
            latestJobId: "job-14c",
            latestJobStatus: "running",
          },
        ],
      },
      isLoading: false,
      isError: false,
    });
    api.useSealJob.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { ApprovalQueuePanel } = await import("@/components/seal/approval-queue-panel");
    wrap(<ApprovalQueuePanel />);
    fireEvent.click(screen.getByRole("button", { name: "▼" }));
    expect(screen.getByText(/Loading job status/i)).toBeInTheDocument();
  });

  it("NodeDetailRail suppresses link for src nodes on flow map", async () => {
    const { NodeDetailRail } = await import("@/components/workflow/node-detail-rail");
    render(<NodeDetailRail nodeId="src:wiki" node={{ label: "Wiki source", sub: "Indexed corpus" }} />);
    expect(screen.getByText("Already on map")).toBeInTheDocument();
  });

  it("NodeDetailRail links agent nodes to dispatch", async () => {
    const { NodeDetailRail } = await import("@/components/workflow/node-detail-rail");
    render(<NodeDetailRail nodeId="agent:worker-1" node={{ label: "Worker", sub: "Handles tasks" }} />);
    expect(screen.getByRole("link", { name: "Open page" })).toHaveAttribute("href", "/dispatch");
  });

  it("ActivityFeed labels fresh events as just now", async () => {
    const old = Date.now;
    Date.now = () => new Date("2026-05-01T12:00:00.000Z").getTime();
    const { ActivityFeed } = await import("@/components/flow/activity-feed");
    render(
      <ActivityFeed
        events={[
          {
            id: "fresh",
            timestamp: "2026-05-01T11:59:55.000Z",
            node: "gateway",
            type: "request",
            message: "Fresh ping",
            severity: "info",
          },
        ]}
      />,
    );
    expect(screen.getByText("just now")).toBeInTheDocument();
    Date.now = old;
  });

  it("DispatchPanel surfaces API error responses", async () => {
    api.useAgents.mockReturnValue({
      data: { agents: [{ id: "a1", name: "A1", role: "r", platform: "cursor", status: "active" }] },
      isLoading: false,
      isError: false,
    });
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "dispatch denied" }),
    } as Response);
    const { DispatchPanel } = await import("@/components/dispatch/dispatch-panel");
    wrap(<DispatchPanel />);
    fireEvent.change(screen.getAllByRole("combobox")[0]!, { target: { value: "a1" } });
    fireEvent.change(screen.getByPlaceholderText("Task summary…"), { target: { value: "fail case" } });
    fireEvent.click(screen.getByRole("button", { name: "Dispatch" }));
    await waitFor(() => expect(screen.getByText("dispatch denied")).toBeInTheDocument());
  });

  it("AdapterStatusPanel shows adapter error copy", async () => {
    api.useBusinessOutcomeEvents.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("l3 offline"),
    });
    const { AdapterStatusPanel } = await import("@/components/business-ops/adapter-status-panel");
    render(<AdapterStatusPanel />);
    expect(screen.getAllByText(/l3 offline/i).length).toBeGreaterThan(0);
  });

  it("ToolAttentionPanel filters capabilities via search input", async () => {
    api.useToolAttention.mockReturnValue({
      data: {
        capabilities: [
          { name: "find-docs", description: "d", type: "mcp", status: "available", topLevel: false },
          { name: "other-tool", description: "d", type: "cli", status: "available", topLevel: false },
        ],
        recommendations: [],
        health: { messages: [] },
        summary: { totalCapabilities: 2, topLevelTools: 0, workspaces: 1, recentOutcomes: 0 },
      },
      isLoading: false,
      isError: false,
    });
    const { ToolAttentionPanel } = await import("@/components/cookbooks/tool-attention-panel");
    wrap(<ToolAttentionPanel />);
    const search = screen.getByPlaceholderText("Search tools");
    fireEvent.change(search, { target: { value: "find-docs" } });
    expect(search).toHaveValue("find-docs");
  });

  it("NodeDetailRail falls back to MemroOS core when nodeId is null", async () => {
    const { NodeDetailRail } = await import("@/components/workflow/node-detail-rail");
    render(<NodeDetailRail nodeId={null} />);
    expect(screen.getByText("MemroOS core")).toBeInTheDocument();
  });

  it("OrchestrationHilPanel shows loading copy", async () => {
    api.useOrchestrationHil.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { OrchestrationHilPanel } = await import("@/components/orchestration/orchestration-hil-panel");
    wrap(<OrchestrationHilPanel />);
    expect(screen.getByText(/Checking orchestration decisions/i)).toBeInTheDocument();
  });

  it("KpiTimelinePanel renders L3 unavailable legend line", async () => {
    api.useEvalHistory.mockReturnValue({
      data: {
        runs: [
          {
            id: "run-14c",
            traceId: "trace-14c",
            agentId: "agent-14c",
            role: "operator",
            compositeW: 0.82,
            trusted: true,
            layers: {
              l1: { score: 0.9, scorers: [] },
              l2: { score: 0.8, scorers: [] },
              l3: { score: null, scorers: [{ metadata: { unavailable: true } }] },
            },
            scorerResults: [],
            judge: { model: "gpt-test", provider: "openai", score: 0.8, rationale: "ok" },
            driftGuard: { passed: true, details: [] },
            configHash: "hash",
            goldenSetPath: "/tmp/golden",
            startedAt: "2026-05-01T10:00:00.000Z",
            completedAt: "2026-05-01T10:05:00.000Z",
          },
        ],
        timestamp: "2026-05-01T10:05:00.000Z",
      },
      isLoading: false,
      isError: false,
    });
    const { KpiTimelinePanel } = await import("@/components/business-ops/kpi-timeline-panel");
    wrap(<KpiTimelinePanel agentId={null} />);
    expect(screen.getByTestId("line-L3 (N/A — unavailable)")).toBeInTheDocument();
  });
});
