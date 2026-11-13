/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent } from "@/types";

const api = vi.hoisted(() => ({
  useContextSourceHealth: vi.fn(),
  useLibraryFreshness: vi.fn(),
  useTriggerQmdUpdate: vi.fn(),
  useRunPolicyLabMutation: vi.fn(),
  useMemoryProposals: vi.fn(),
  useMemoryProposalActionMutation: vi.fn(),
  useAgents: vi.fn(),
  useAgentPeers: vi.fn(),
  useHiveFeed: vi.fn(),
  useEvalHistory: vi.fn(),
  useUpdateSkillReviewMutation: vi.fn(),
  useApproveApoProposalMutation: vi.fn(),
  useHealth: vi.fn(),
  useDelegations: vi.fn(),
  useSecurityReport: vi.fn(),
  useEscalations: vi.fn(),
  useSkills: vi.fn(),
  useModelRoutingDashboard: vi.fn(),
  useModelUsage: vi.fn(),
  useMemoryStats: vi.fn(),
  useEvalConfig: vi.fn(),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, ...api };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/ledger",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

vi.mock("@/components/layout/sidebar", () => ({ Sidebar: () => <nav data-testid="sidebar" /> }));
vi.mock("@/components/layout/top-bar", () => ({ TopBar: () => <header data-testid="topbar" /> }));
vi.mock("@/components/layout/section-tabs", () => ({
  SectionTabs: () => <div data-testid="section-tabs" />,
}));
vi.mock("@/components/layout/storage-panic-banner", () => ({ StoragePanicBanner: () => null }));

vi.mock("recharts", () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/shared/charts", () => ({
  HBars: () => <div data-testid="hbars" />,
  Spark: () => <div data-testid="spark" />,
}));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-batch14b",
    name: "Batch Agent",
    role: "Engineer",
    platform: "codex",
    status: "active",
    lastHeartbeat: null,
    currentTask: null,
    lessonsCount: 0,
    todayMemoryCount: 0,
    ...overrides,
  };
}

describe("Long-tail components batch14b extra", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/api/auth/me")) {
          return { ok: true, json: async () => ({ role: "operator" }) };
        }
        if (url.includes("/api/flow/topology")) {
          return {
            ok: true,
            json: async () => ({
              nodes: [
                {
                  id: "core-1",
                  x: 10,
                  y: 10,
                  w: 80,
                  h: 40,
                  t: "core",
                  label: "Core",
                  sub: "batch14b",
                  live: true,
                },
              ],
              edges: [],
              columns: [{ x: 100, label: "GATEWAY" }],
              canvas: { width: 1200, height: 600 },
              notices: [],
              generatedAt: "2026-05-01T00:00:00.000Z",
            }),
          };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );

    api.useContextSourceHealth.mockReturnValue({
      data: { sources: [{ id: "src-1", label: "Docs", status: "ok", ageMs: 120_000 }] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    api.useLibraryFreshness.mockReturnValue({
      data: { collections: [{ name: "business", state: "live", ageMs: 60_000 }] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    api.useTriggerQmdUpdate.mockReturnValue({ events: [], isStreaming: false, trigger: vi.fn() });
    api.useRunPolicyLabMutation.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
      data: {
        goldenSetId: "./golden-sets/business-ops-50.jsonl",
        ranked: [
          {
            rank: 1,
            name: "k=5 multi-tier",
            compositeW: 0.8123,
            layerScores: { l1: 0.8, l2: 0.7, l3: 0.9 },
            variantConfig: { k: 5 },
            evalRunId: "eval-batch14b",
          },
        ],
      },
    });
    api.useMemoryProposals.mockReturnValue({
      data: {
        proposals: [
          {
            id: "mp-1",
            traceId: "trace-batch14b",
            runId: "run-batch14b",
            agentId: "agent-batch14b",
            proposalType: "memory_rewrite",
            status: "pending",
            diff: { weights: { recall: 0.9 } },
            rationale: "Rewrite recall weights",
            forecastWDelta: 0.02,
            baselineW: 0.8123,
            baselineRunId: "baseline-run",
            baselineLayers: {
              l1: { score: 0.8, weight: 0.3 },
              l2: { score: 0.7, weight: 0.3 },
              l3: { score: 0.9, weight: 0.4 },
            },
            createdAt: "2026-05-01T00:00:00.000Z",
            updatedAt: "2026-05-01T00:00:00.000Z",
          },
        ],
        types: {},
      },
      isLoading: false,
    });
    api.useMemoryProposalActionMutation.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false });
    api.useAgents.mockReturnValue({
      data: {
        agents: [
          {
            ...makeAgent(),
            liveness: { state: "live", observedAt: new Date().toISOString(), source: "/api/agents" },
          },
        ],
        summary: { active: { value: 1, status: "live" } },
      },
      isLoading: false,
      isError: false,
    });
    api.useAgentPeers.mockReturnValue({ data: { peers: [] }, isLoading: false, isError: false });
    api.useHiveFeed.mockReturnValue({
      data: { actions: [{ agent_id: "agent-batch14b", action: "run", timestamp: new Date().toISOString() }] },
      isLoading: false,
      isError: false,
    });
    api.useEvalHistory.mockReturnValue({ data: { runs: [] }, isLoading: false, isError: false });
    api.useUpdateSkillReviewMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    api.useApproveApoProposalMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    api.useHealth.mockReturnValue({ data: { services: [] }, isLoading: false, isError: false });
    api.useDelegations.mockReturnValue({ data: { delegations: [] }, isLoading: false, isError: false, refetch: vi.fn() });
    api.useSecurityReport.mockReturnValue({
      data: { summary: { highSeverity: 0 }, timeline: [], auditActivity: [] },
      isLoading: false,
      isError: false,
    });
    api.useEscalations.mockReturnValue({ data: { escalations: [] }, isLoading: false, isError: false });
    api.useSkills.mockReturnValue({
      data: {
        skillDetails: [],
        skillBudget: { duplicateSkills: [] },
        coverageGaps: [],
      },
      isLoading: false,
      isError: false,
    });
    api.useModelRoutingDashboard.mockReturnValue({ data: { events: [], summary: {} }, isLoading: false, isError: false });
    api.useModelUsage.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    api.useMemoryStats.mockReturnValue({ data: { sources: [] }, isLoading: false, isError: false });
    api.useEvalConfig.mockReturnValue({
      data: { config: { weights: { l1: 0.3, l2: 0.3, l3: 0.4 } } },
      isLoading: false,
      isError: false,
    });
  });

  it("ContextSourcesPanel renders source health and freshness sections", async () => {
    const { ContextSourcesPanel } = await import("@/components/library/context-sources-panel");
    wrap(<ContextSourcesPanel />);
    expect(screen.getByText(/Context Sources/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/Index Freshness/i)).toBeInTheDocument();
    });
  });

  it("PolicyLabPanel shows ranked results and rejects invalid variant JSON", async () => {
    const { PolicyLabPanel } = await import("@/components/memory/policy-lab-panel");
    wrap(<PolicyLabPanel />);
    expect(screen.getByText(/Memory Policy Lab/i)).toBeInTheDocument();
    expect(screen.getByText(/W Rankings \(1 variants\)/i)).toBeInTheDocument();

    const variantAreas = screen.getAllByRole("textbox");
    fireEvent.change(variantAreas[variantAreas.length - 1]!, {
      target: { value: "not-json" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Run ranking/i }));
    expect(screen.getByText(/Invalid JSON in variants field/i)).toBeInTheDocument();
  });

  it("MemoryProposalsPanel renders pending proposal row", async () => {
    const { MemoryProposalsPanel } = await import("@/components/memory/memory-proposals-panel");
    wrap(<MemoryProposalsPanel />);
    expect(screen.getByText(/Rewrite recall weights/i)).toBeInTheDocument();
  });

  it("AgentRegistrationForm submits manual registration", async () => {
    const onSubmit = vi.fn();
    const { AgentRegistrationForm } = await import("@/components/agents/agent-registration-form");
    render(<AgentRegistrationForm onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    fireEvent.change(screen.getByLabelText("Agent name"), { target: { value: "Batch14b Agent" } });
    fireEvent.change(screen.getByLabelText("Agent role"), { target: { value: "Tester" } });
    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Batch14b Agent", role: "Tester" }),
    );
  });

  it("AgentWorkload renders hive-driven workload bars", async () => {
    const { AgentWorkload } = await import("@/components/operations/agent-workload");
    wrap(<AgentWorkload filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByText(/Agent workload/i)).toBeInTheDocument();
    expect(screen.getByTestId("hbars")).toBeInTheDocument();
  });

  it("AgentGrid renders flat agents and empty sections fallback", async () => {
    const { AgentGrid } = await import("@/components/memroos/agent-grid");
    const { rerender } = render(<AgentGrid agents={[makeAgent()]} />);
    expect(screen.getByText("Batch Agent")).toBeInTheDocument();
    rerender(<AgentGrid sections={[]} />);
    expect(screen.getByText(/No agents found/i)).toBeInTheDocument();
  });

  it("ConsentDialog requires checkbox before confirming", async () => {
    const onConfirm = vi.fn();
    const { ConsentDialog } = await import("@/components/voice/consent-dialog");
    render(<ConsentDialog open onCancel={vi.fn()} onConfirm={onConfirm} />);
    const confirm = screen.getByRole("button", { name: /Confirm/i });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalled();
  });

  it("NocHeader renders operations telemetry header and export control", async () => {
    const { NocHeader } = await import("@/components/operations/noc-header");
    render(
      <NocHeader
        windowLabel="24h"
        workspace="all"
        onWindowChange={vi.fn()}
        onWorkspaceChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Operations · live telemetry/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export report/i })).toBeInTheDocument();
  });

  it("KpiTimelinePanel renders empty eval history state", async () => {
    const { KpiTimelinePanel } = await import("@/components/business-ops/kpi-timeline-panel");
    wrap(<KpiTimelinePanel agentId={null} />);
    expect(screen.getByText(/No eval runs found/i)).toBeInTheDocument();
  });

  it("SkillsList renders workflow stages and coverage gaps", async () => {
    const { SkillsList } = await import("@/components/cookbooks/skills-list");
    render(
      <SkillsList
        totalSkills={2}
        allSkills={["alpha-skill", "beta-skill"]}
        coverageGaps={["missing-skill"]}
        skillDetails={[]}
      />,
    );
    expect(screen.getByText(/Review pipeline/i)).toBeInTheDocument();
    expect(screen.getByText(/1 coverage gaps/i)).toBeInTheDocument();
  });

  it("ProposalCard renders pending APO tracking copy", async () => {
    const { ProposalCard } = await import("@/components/apo/proposal-card");
    render(
      <ProposalCard
        proposal={{
          id: "apo-1",
          filename: "skill.md",
          skill: "batch14b-skill",
          subsystem: "skills",
          timestamp: "2026-05-01T12:00:00.000Z",
          content: "proposal body",
          status: "pending",
        }}
      />,
    );
    expect(screen.getByText(/Awaiting review/i)).toBeInTheDocument();
  });

  it("TopologyCanvas loads topology from API", async () => {
    const { TopologyCanvas } = await import("@/components/workflow/topology-canvas");
    render(<TopologyCanvas selectedId={null} onSelect={vi.fn()} onSelectNode={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("GATEWAY")).toBeInTheDocument();
    });
  });

  it("Shell layout renders sidebar and top bar for ledger route", async () => {
    const { Shell } = await import("@/components/layout/shell");
    render(
      <Shell>
        <div>batch14b child</div>
      </Shell>,
    );
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("topbar")).toBeInTheDocument();
    expect(screen.getByText("batch14b child")).toBeInTheDocument();
  });

  it("BehaviorSignals panel renders signal heading", async () => {
    const { BehaviorSignals } = await import("@/components/operations/behavior-signals");
    render(<BehaviorSignals filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByText(/Behavior signals · things to dig into/i)).toBeInTheDocument();
  });

  it("Savings panel renders savings heading", async () => {
    const { Savings } = await import("@/components/operations/savings-waste");
    render(<Savings filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByText(/Savings source/i)).toBeInTheDocument();
  });

  it("Waste panel renders waste heading", async () => {
    const { Waste } = await import("@/components/operations/savings-waste");
    render(<Waste filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByText(/^Waste$/i)).toBeInTheDocument();
  });

  it("Library HealthPanel renders health heading", async () => {
    const { HealthPanel } = await import("@/components/library/health-panel");
    render(
      <HealthPanel
        totalFiles={12}
        collections={[{ name: "business", docCount: 12, category: "business", lastUpdated: null }]}
      />,
    );
    expect(screen.getByText(/Meeting \+ Call Recordings/i)).toBeInTheDocument();
  });

  it("DispatchPanel renders dispatch heading", async () => {
    const { DispatchPanel } = await import("@/components/dispatch/dispatch-panel");
    wrap(<DispatchPanel />);
    expect(screen.getByText("Dispatch Task")).toBeInTheDocument();
  });
});
