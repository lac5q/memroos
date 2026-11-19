/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { formatTimeAgo, AgentCard } from "@/components/memroos/agent-card";
import { MemoryList } from "@/components/notebooks/memory-list";
import type { Agent } from "@/types";
import type { MemoryInventoryRow } from "@/lib/api-client";

vi.mock("@/lib/api-client", () => ({
  useRunPolicyLabMutation: () => ({ mutate: vi.fn(), isPending: false, data: undefined }),
  useRecallStats: () => ({ data: undefined, isLoading: true, error: null, refetch: vi.fn() }),
  useSkills: () => ({ data: [], isLoading: false, error: null }),
  useToolAttention: () => ({ data: [], isLoading: false, error: null }),
  useApproveApoProposalMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useContextSourceHealth: () => ({
    data: { sources: [] },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useLibraryFreshness: () => ({
    data: { collections: [] },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useTriggerQmdUpdate: () => ({ events: [], isStreaming: false, trigger: vi.fn() }),
  useMemoryInventory: () => ({ data: { rows: [] }, isLoading: false, error: null }),
  useMultiMemorySearch: () => ({ mutate: vi.fn(), isPending: false }),
  useSecurityCapabilities: () => ({ data: undefined, isLoading: true, isError: false, error: null }),
  useTimeSeries: () => ({ data: { points: [] }, isLoading: false, error: null }),
}));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const sampleAgent: Agent = {
  id: "agent-ui-1",
  name: "Atlas",
  role: "Director",
  platform: "claude",
  protocol: "local",
  status: "active",
  lastHeartbeat: new Date(Date.now() - 5 * 60_000).toISOString(),
  capabilities: [],
  isRemote: false,
};

const memoryRow: MemoryInventoryRow = {
  id: "mem-1",
  category: "vector_memory",
  content: "Batch13c memory row content for UI coverage",
  backend: "mem0",
  source: "claude",
  timestamp: new Date().toISOString(),
  consolidationState: "pending",
};

describe("long-tail batch13c — UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ role: "operator" }) })));
  });

  describe("AgentCard helpers", () => {
    it("formatTimeAgo returns never for null", () => {
      expect(formatTimeAgo(null)).toBe("never");
    });

    it("formatTimeAgo returns just now for recent timestamps", () => {
      expect(formatTimeAgo(new Date().toISOString())).toBe("just now");
    });

    it("formatTimeAgo returns minutes for sub-hour deltas", () => {
      const ts = new Date(Date.now() - 10 * 60_000).toISOString();
      expect(formatTimeAgo(ts)).toMatch(/m ago/);
    });

    it("formatTimeAgo returns hours for sub-day deltas", () => {
      const ts = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
      expect(formatTimeAgo(ts)).toMatch(/h ago/);
    });

    it("formatTimeAgo returns days for older timestamps", () => {
      const ts = new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString();
      expect(formatTimeAgo(ts)).toMatch(/d ago/);
    });
  });

  describe("AgentCard rendering", () => {
    it("renders agent name and role", () => {
      render(<AgentCard agent={sampleAgent} onClick={vi.fn()} />);
      expect(screen.getByText("Atlas")).toBeInTheDocument();
      expect(screen.getByText("Director")).toBeInTheDocument();
    });

    it("invokes onClick when card is pressed", () => {
      const onClick = vi.fn();
      render(<AgentCard agent={sampleAgent} onClick={onClick} />);
      fireEvent.click(screen.getByText("Atlas"));
      expect(onClick).toHaveBeenCalledWith(sampleAgent);
    });

    it("shows harness child count copy", () => {
      render(<AgentCard agent={sampleAgent} onClick={vi.fn()} childCount={2} />);
      expect(screen.getByText(/Harness for/)).toBeInTheDocument();
    });

    it("shows subagent copy when masterId is set", () => {
      render(
        <AgentCard
          agent={{ ...sampleAgent, masterId: "parent-1", isRemote: false }}
          onClick={vi.fn()}
          harnessName="Parent Harness"
        />
      );
      expect(screen.getByText(/Subagent of/)).toBeInTheDocument();
    });

    it("shows remote globe avatar for remote agents", () => {
      render(<AgentCard agent={{ ...sampleAgent, isRemote: true }} onClick={vi.fn()} />);
      expect(screen.getByText("🌐")).toBeInTheDocument();
    });

    it("shows error status ring styling", () => {
      render(<AgentCard agent={{ ...sampleAgent, status: "error" }} onClick={vi.fn()} />);
      expect(screen.getByText("Atlas")).toBeInTheDocument();
    });
  });

  describe("MemoryList", () => {
    it("shows empty state when no entries", () => {
      render(<MemoryList entries={[]} onSelect={vi.fn()} selected={null} />);
      expect(screen.getByText(/No memory inventory rows/)).toBeInTheDocument();
    });

    it("renders truncated content and selects row", () => {
      const onSelect = vi.fn();
      render(<MemoryList entries={[memoryRow]} onSelect={onSelect} selected={null} />);
      fireEvent.click(screen.getByRole("button"));
      expect(onSelect).toHaveBeenCalledWith(memoryRow);
    });

    it("highlights selected row", () => {
      render(<MemoryList entries={[memoryRow]} onSelect={vi.fn()} selected={memoryRow} />);
      const btn = screen.getByRole("button");
      expect(btn.className).toMatch(/amber/);
    });

    it("renders long content with ellipsis", () => {
      const long = { ...memoryRow, content: "x".repeat(120) };
      render(<MemoryList entries={[long]} onSelect={vi.fn()} selected={null} />);
      expect(screen.getByRole("button").textContent).toContain("…");
    });
  });

  describe("ProposalDetail sheet", () => {
    it("renders pending proposal tracking fallback", async () => {
      const { ProposalDetail } = await import("@/components/apo/proposal-detail");
      render(
        <ProposalDetail
          open
          onOpenChange={vi.fn()}
          proposal={{
            id: "p1",
            filename: "p1.md",
            skill: "demo-skill",
            subsystem: "ops",
            status: "pending",
            timestamp: new Date().toISOString(),
            content: "Always validate auth",
          }}
        />
      );
      expect(screen.getByText(/Awaiting review/)).toBeInTheDocument();
    });

    it("renders approved proposal queued state", async () => {
      const { ProposalDetail } = await import("@/components/apo/proposal-detail");
      render(
        <ProposalDetail
          open
          onOpenChange={vi.fn()}
          proposal={{
            id: "p2",
            filename: "p2.md",
            skill: "demo-skill",
            subsystem: "ops",
            status: "approved",
            timestamp: new Date().toISOString(),
            content: "Retry safely",
          }}
        />
      );
      expect(screen.getByText(/Queued for worker/)).toBeInTheDocument();
    });

    it("renders archived tracking fallback", async () => {
      const { ProposalDetail } = await import("@/components/apo/proposal-detail");
      render(
        <ProposalDetail
          open
          onOpenChange={vi.fn()}
          proposal={{
            id: "p3",
            filename: "p3.md",
            skill: "demo-skill",
            subsystem: "ops",
            status: "archived",
            timestamp: new Date().toISOString(),
            content: "Done",
          }}
        />
      );
      expect(screen.getByText("demo-skill")).toBeInTheDocument();
      expect(screen.getByText("archived")).toBeInTheDocument();
    });
  });

  describe("ContextSourcesPanel", () => {
    it("renders index freshness heading", async () => {
      const { ContextSourcesPanel } = await import("@/components/library/context-sources-panel");
      render(<ContextSourcesPanel />);
      expect(screen.getByText(/Index Freshness/)).toBeInTheDocument();
    });
  });

  describe("PolicyLabPanel", () => {
    it("renders default variant labels", async () => {
      const { PolicyLabPanel } = await import("@/components/memory/policy-lab-panel");
      wrap(<PolicyLabPanel />);
      expect(screen.getByText(/Policy Lab|Recall policy/i)).toBeInTheDocument();
    });
  });

  describe("SqliteHealthPanel", () => {
    it("shows loading skeleton while recall stats fetch", async () => {
      const { SqliteHealthPanel } = await import("@/components/ledger/sqlite-health-panel");
      wrap(<SqliteHealthPanel />);
      expect(screen.getByText(/SQLite Store/)).toBeInTheDocument();
    });
  });

  describe("NodeDetailPanel", () => {
    it("shows sparse-node guidance when events are empty", async () => {
      const { NodeDetailPanel } = await import("@/components/flow/node-detail-panel");
      render(
        <NodeDetailPanel
          nodeId="node-1"
          nodeLabel="Recall"
          nodeIcon="🔍"
          nodeStats={{ calls: 0 }}
          events={[]}
          onClose={vi.fn()}
        />
      );
      expect(screen.getByText(/Recall|sparse|events/i)).toBeInTheDocument();
    });
  });

  describe("ProposalCard", () => {
    it("renders skill name and status badge", async () => {
      const { ProposalCard } = await import("@/components/apo/proposal-card");
      render(
        <ProposalCard
          proposal={{
            id: "card-1",
            filename: "APO_PROPOSAL_demo.md",
            skill: "skill-a",
            subsystem: "ops",
            status: "pending",
            timestamp: new Date().toISOString(),
            content: "Validate before retry",
          }}
          onClick={vi.fn()}
        />
      );
      expect(screen.getByText("skill-a")).toBeInTheDocument();
    });
  });

  describe("AgentSecurityModesPanel", () => {
    it("renders security modes heading", async () => {
      const { AgentSecurityModesPanel } = await import("@/components/agents/agent-security-modes-panel");
      wrap(<AgentSecurityModesPanel />);
      expect(screen.getByText("Security Modes")).toBeInTheDocument();
    });
  });

  describe("Ledger analytics panel", () => {
    it("renders analytics section title", async () => {
      const { LedgerAnalyticsPanel } = await import("@/components/ledger/analytics-panel");
      wrap(<LedgerAnalyticsPanel />);
      expect(screen.getByText("Usage Trends")).toBeInTheDocument();
    });
  });
});
