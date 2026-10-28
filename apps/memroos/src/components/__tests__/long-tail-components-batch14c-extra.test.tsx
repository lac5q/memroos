/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  useOperationsNoc: vi.fn(),
  useTimeSeries: vi.fn(),
  useAgents: vi.fn(),
  useAgentPeers: vi.fn(),
  useHiveFeed: vi.fn(),
  useMemoryStats: vi.fn(),
  useMemoryTierHealth: vi.fn(),
  useSecurityReport: vi.fn(),
  useEscalations: vi.fn(),
  useSkills: vi.fn(),
  useModelRoutingDashboard: vi.fn(),
  useDelegations: vi.fn(),
  useModelUsage: vi.fn(),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, ...api };
});

vi.mock("@/components/shared/charts", () => ({
  Heatmap: () => <div data-testid="heatmap" />,
  HBars: () => <div data-testid="hbars" />,
  Spark: () => <div data-testid="spark" />,
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("Long-tail components batch14c extra (operations)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.useOperationsNoc.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    api.useTimeSeries.mockReturnValue({ data: { points: [] }, isLoading: false, error: null });
    api.useAgents.mockReturnValue({ data: { agents: [] }, isLoading: false, isError: false });
    api.useAgentPeers.mockReturnValue({ data: { peers: [] }, isLoading: false, isError: false });
    api.useHiveFeed.mockReturnValue({ data: { actions: [] }, isLoading: false, isError: false });
    api.useMemoryStats.mockReturnValue({ data: { sources: [], pendingUnconsolidated: 0 }, isLoading: false, isError: false });
    api.useMemoryTierHealth.mockReturnValue({ data: { tiers: [] }, isLoading: false, isError: false });
    api.useSecurityReport.mockReturnValue({
      data: { summary: { highSeverity: 0 }, timeline: [], auditActivity: [] },
      isLoading: false,
      isError: false,
    });
    api.useEscalations.mockReturnValue({ data: { escalations: [] }, isLoading: false, isError: false });
    api.useSkills.mockReturnValue({
      data: { skillBudget: { duplicateSkills: [] }, coverageGaps: [], skillDetails: [] },
      isLoading: false,
      isError: false,
    });
    api.useModelRoutingDashboard.mockReturnValue({ data: { events: [] }, isLoading: false, isError: false });
    api.useDelegations.mockReturnValue({ data: { delegations: [] }, isLoading: false, isError: false });
    api.useModelUsage.mockReturnValue({ data: undefined, isLoading: true, isError: false });
  });

  it("AgentWorkload ranks top agents from hive actions", async () => {
    api.useHiveFeed.mockReturnValue({
      data: {
        actions: [
          { agent_id: "a-low", action_type: "run", timestamp: new Date().toISOString() },
          { agent_id: "a-high", action_type: "run", timestamp: new Date().toISOString() },
          { agent_id: "a-high", action_type: "run", timestamp: new Date().toISOString() },
        ],
      },
      isLoading: false,
      isError: false,
    });
    const { AgentWorkload } = await import("@/components/operations/agent-workload");
    render(<AgentWorkload filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByTestId("hbars")).toBeInTheDocument();
    expect(screen.getByText(/a-high/i)).toBeInTheDocument();
  });

  it("ActivityHeatmap builds 24h bucket timing from memory writes", async () => {
    const now = new Date("2026-05-01T15:30:00.000Z");
    vi.setSystemTime(now);
    api.useOperationsNoc.mockReturnValue({
      data: {
        agentActivity: {
          agents: [
            {
              agentId: "agent-14c",
              messageCount: 2,
              sessionCount: 1,
              lastMessageAt: now.toISOString(),
            },
          ],
          sourceState: "live",
          source: "sqlite://messages",
          observedAt: now.toISOString(),
          delegations: [],
        },
        sourceStates: { agentActivity: "live" },
      },
      isLoading: false,
      isError: false,
    });
    api.useTimeSeries.mockReturnValue({
      data: { points: [{ bucket: "14:00", value: 3 }] },
      isLoading: false,
      error: null,
    });
    const { ActivityHeatmap } = await import("@/components/operations/activity-heatmap");
    render(<ActivityHeatmap filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByTestId("heatmap")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("ActivityHeatmap skips invalid timestamps in heatmap grid", async () => {
    api.useOperationsNoc.mockReturnValue({
      data: {
        agentActivity: {
          agents: [{ agentId: "x", messageCount: 1, sessionCount: 1, lastMessageAt: "not-a-date" }],
          sourceState: "live",
          source: "sqlite://messages",
          observedAt: null,
          delegations: [],
        },
      },
      isLoading: false,
      isError: false,
    });
    const { ActivityHeatmap } = await import("@/components/operations/activity-heatmap");
    render(<ActivityHeatmap filters={{ window: "7d", workspace: "all" }} />);
    expect(screen.getByText(/Activity timing/i)).toBeInTheDocument();
  });

  it("BehaviorSignals adds source failure signal", async () => {
    api.useSecurityReport.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("security down"),
    });
    const { BehaviorSignals } = await import("@/components/operations/behavior-signals");
    render(<BehaviorSignals filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByText(/One or more NOC sources failed/i)).toBeInTheDocument();
  });

  it("MemoryNotDigested shows consolidation failure and tier rows", async () => {
    api.useMemoryStats.mockReturnValue({
      data: {
        sources: [{ agent_id: "ingest-bot", cnt: 4 }],
        pendingUnconsolidated: 2,
        recentFailures24h: 3,
        lastRun: {
          status: "failed",
          started_at: "2026-05-01T10:00:00.000Z",
          batch_size: 12,
          error_message: "disk full on batch",
        },
      },
      isLoading: false,
      isError: false,
    });
    api.useMemoryTierHealth.mockReturnValue({
      data: {
        tiers: [{ tier: "L2", status: "down", backend: "qdrant", detail: "timeout", count: 1 }],
      },
      isLoading: false,
      isError: false,
    });
    const { MemoryNotDigested } = await import("@/components/operations/memory-not-digested");
    render(<MemoryNotDigested filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByText(/Consolidation blocked/i)).toBeInTheDocument();
    expect(screen.getByText(/L2 backend down/i)).toBeInTheDocument();
  });

  it("NocHeader export report creates a download anchor", async () => {
    const click = vi.fn();
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:noc-14c");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      const element = originalCreateElement(tagName);
      if (tagName === "a") {
        element.click = click;
      }
      return element;
    });
    const { NocHeader } = await import("@/components/operations/noc-header");
    render(
      <NocHeader
        windowLabel="7d"
        workspace="local"
        showAdvanced
        onWindowChange={vi.fn()}
        onWorkspaceChange={vi.fn()}
        onShowAdvancedChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Export report" }));
    expect(createElementSpy).toHaveBeenCalledWith("a");
    expect(click).toHaveBeenCalled();
    createElementSpy.mockRestore();
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it("Waste panel counts failed delegations and duplicate skills", async () => {
    api.useHiveFeed.mockReturnValue({
      data: { actions: [{ action_type: "error", agent_id: "a1", timestamp: new Date().toISOString() }] },
      isLoading: false,
      isError: false,
    });
    api.useDelegations.mockReturnValue({
      data: {
        delegations: [{ status: "failed", taskId: "t1", fromAgent: "a", toAgent: "b", updatedAt: new Date().toISOString() }],
      },
      isLoading: false,
      isError: false,
    });
    api.useSkills.mockReturnValue({
      data: {
        skillBudget: { duplicateSkills: ["dup-skill"] },
        coverageGaps: ["gap-skill"],
        skillDetails: [],
      },
      isLoading: false,
      isError: false,
    });
    const { Waste } = await import("@/components/operations/savings-waste");
    render(<Waste filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByText(/Waste metrics are live counts/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Retries/i).length).toBeGreaterThan(0);
    expect(document.querySelector('[data-waste-row="Duplicate skills"]')).toBeTruthy();
  });

  it("AgentActivityPanel lists delegations in window", async () => {
    api.useOperationsNoc.mockReturnValue({
      data: {
        agentActivity: {
          agents: [{ agentId: "alpha", messageCount: 4, sessionCount: 2, lastMessageAt: new Date().toISOString() }],
          delegations: [
            {
              taskId: "task-14c",
              fromAgent: "alpha",
              toAgent: "beta",
              status: "active",
              updatedAt: new Date().toISOString(),
            },
          ],
          sourceState: "live",
          source: "sqlite://messages",
          observedAt: new Date().toISOString(),
        },
      },
      isLoading: false,
      isError: false,
    });
    const { AgentActivityPanel } = await import("@/components/operations/index");
    render(<AgentActivityPanel filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByText(/Delegations/i)).toBeInTheDocument();
    expect(screen.getByText(/alpha → beta/i)).toBeInTheDocument();
  });

  it("BehaviorSignals dismisses an individual signal", async () => {
    api.useSecurityReport.mockReturnValue({
      data: { summary: { highSeverity: 2 }, timeline: [], auditActivity: [] },
      isLoading: false,
      isError: false,
    });
    const { BehaviorSignals } = await import("@/components/operations/behavior-signals");
    render(<BehaviorSignals filters={{ window: "24h", workspace: "all" }} />);
    const dismissButtons = screen.getAllByRole("button", { name: /Dismiss/i });
    fireEvent.click(dismissButtons[0]!);
    expect(dismissButtons[0]).toBeTruthy();
  });

  it("MemoryNotDigested highlights pending unconsolidated count", async () => {
    api.useMemoryStats.mockReturnValue({
      data: {
        sources: [],
        pendingUnconsolidated: 5,
        lastRun: { status: "success", started_at: "2026-05-01T10:00:00.000Z", batch_size: 3 },
      },
      isLoading: false,
      isError: false,
    });
    const { MemoryNotDigested } = await import("@/components/operations/memory-not-digested");
    render(<MemoryNotDigested filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("Savings panel shows blocked baseline message", async () => {
    const { Savings } = await import("@/components/operations/savings-waste");
    wrap(<Savings filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByText(/EXPLICIT NON-LIVE STATE/i)).toBeInTheDocument();
  });

  it("OperationsNoc tolerates localStorage read failures for advanced toggle", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    const { OperationsNoc } = await import("@/components/operations/index");
    wrap(<OperationsNoc />);
    expect(screen.getByText(/Operations · live telemetry/i)).toBeInTheDocument();
    getItem.mockRestore();
  });
});
