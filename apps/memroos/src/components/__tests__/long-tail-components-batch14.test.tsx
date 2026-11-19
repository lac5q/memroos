/**
 * @vitest-environment jsdom
 */
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

vi.mock("@/components/shared/charts", () => ({
  Spark: () => <div data-testid="spark" />,
}));

vi.mock("@/components/dispatch/lineage-drawer", () => ({
  LineageDrawer: () => <span data-testid="lineage" />,
}));

const api = vi.hoisted(() => ({
  useAgents: vi.fn(),
  useDelegations: vi.fn(),
  useSecurityReport: vi.fn(),
  useEscalations: vi.fn(),
  useSkills: vi.fn(),
  useModelRoutingDashboard: vi.fn(),
  useMemoryStats: vi.fn(),
  useModelUsage: vi.fn(),
  useHiveFeed: vi.fn(),
  useActivityHeatmap: vi.fn(),
  useOperationsNoc: vi.fn(),
  useTimeSeries: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  useAgents: api.useAgents,
  useDelegations: api.useDelegations,
  useSecurityReport: api.useSecurityReport,
  useEscalations: api.useEscalations,
  useSkills: api.useSkills,
  useModelRoutingDashboard: api.useModelRoutingDashboard,
  useMemoryStats: api.useMemoryStats,
  useModelUsage: api.useModelUsage,
  useHiveFeed: api.useHiveFeed,
  useActivityHeatmap: api.useActivityHeatmap,
  useOperationsNoc: api.useOperationsNoc,
  useTimeSeries: api.useTimeSeries,
}));

import { ActivityFeed } from "@/components/flow/activity-feed";
import {
  formatFreshness,
  formatObservedAt,
  statusBadgeColor,
} from "@/components/operations/noc-primitives";
import { BehaviorSignals } from "@/components/operations/behavior-signals";
import { DispatchPanel } from "@/components/dispatch/dispatch-panel";
import { NodeDetailRail } from "@/components/workflow/node-detail-rail";
import { HealthPanel as LibraryHealthPanel } from "@/components/library/health-panel";
import { HealthPanel as CookbooksHealthPanel } from "@/components/cookbooks/health-panel";
import { Savings, Waste } from "@/components/operations/savings-waste";

describe("Long-tail components batch14", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  describe("ActivityFeed", () => {
    it("shows empty copy when no events", () => {
      render(<ActivityFeed events={[]} />);
      expect(screen.getByText(/No recent activity detected/i)).toBeInTheDocument();
    });

    it("renders events with hover callbacks and hour labels", () => {
      const onNodeHover = vi.fn();
      const old = Date.now;
      Date.now = () => new Date("2026-05-01T12:00:00.000Z").getTime();
      render(
        <ActivityFeed
          events={[
            {
              id: "e1",
              timestamp: "2026-05-01T11:00:00.000Z",
              node: "Recall",
              type: "unknown",
              message: "Batch14 activity",
              severity: "info",
            },
          ]}
          onNodeHover={onNodeHover}
          highlightedNode="Recall"
        />,
      );
      fireEvent.mouseEnter(screen.getByText("Batch14 activity"));
      expect(onNodeHover).toHaveBeenCalledWith("Recall");
      expect(screen.getByText(/1h ago/)).toBeInTheDocument();
      Date.now = old;
    });
  });

  describe("noc-primitives helpers", () => {
    it("formats observed timestamps and freshness tiers", () => {
      expect(formatObservedAt(null)).toBe("—");
      expect(formatObservedAt("not-a-date")).toBe("not-a-date");
      expect(formatFreshness(30_000)).toMatch(/s$/);
      expect(formatFreshness(120_000)).toMatch(/m$/);
      expect(formatFreshness(3_600_000)).toMatch(/h$/);
      expect(formatFreshness(86_400_000)).toMatch(/d$/);
      expect(statusBadgeColor("error").color).toBeTruthy();
    });
  });

  describe("BehaviorSignals", () => {
    function mockBehaviorSources(overrides: Partial<Record<string, unknown>> = {}) {
      api.useSecurityReport.mockReturnValue({
        data: { summary: { highSeverity: 1 } },
        isLoading: false,
        isError: false,
        ...overrides.security,
      });
      api.useEscalations.mockReturnValue({
        data: { escalations: [{ status: "open" }] },
        isLoading: false,
        isError: false,
        ...overrides.escalations,
      });
      api.useSkills.mockReturnValue({
        data: { skillDetails: [{ health: "needs-source" }] },
        isLoading: false,
        isError: false,
        ...overrides.skills,
      });
      api.useModelRoutingDashboard.mockReturnValue({
        data: { events: [{ success: false }] },
        isLoading: false,
        isError: false,
        ...overrides.routing,
      });
      api.useMemoryStats.mockReturnValue({
        data: { pendingUnconsolidated: 3 },
        isLoading: false,
        isError: false,
        ...overrides.memory,
      });
    }

    it("lists live signals and supports dismiss", () => {
      mockBehaviorSources();
      render(<BehaviorSignals filters={{ window: "7d", workspace: "all" }} />);
      expect(screen.getByText(/high-severity security events/i)).toBeInTheDocument();
      fireEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[0]!);
      expect(screen.getByText(/visible ·/i)).toBeInTheDocument();
    });

    it("shows empty state when all sources are clean", () => {
      mockBehaviorSources({
        security: { data: { summary: { highSeverity: 0 } } },
        escalations: { data: { escalations: [] } },
        skills: { data: { skillDetails: [] } },
        routing: { data: { events: [] } },
        memory: { data: { pendingUnconsolidated: 0 } },
      });
      render(<BehaviorSignals />);
      expect(screen.getByText(/No live behavior signals/i)).toBeInTheDocument();
    });
  });

  describe("DispatchPanel", () => {
    it("dispatches tasks and shows queued notice", async () => {
      const refetch = vi.fn();
      api.useAgents.mockReturnValue({
        data: { agents: [{ id: "agent-1", name: "Ops", platform: "cursor" }] },
      });
      api.useDelegations.mockReturnValue({
        data: { delegations: [] },
        isLoading: false,
        refetch,
      });
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ mode: "queued" }),
      } as Response);

      render(<DispatchPanel />);
      fireEvent.change(screen.getByDisplayValue("Select agent…"), { target: { value: "agent-1" } });
      fireEvent.change(screen.getByPlaceholderText(/Task summary/i), { target: { value: "Run checks" } });
      fireEvent.click(screen.getByRole("button", { name: "Dispatch" }));

      await waitFor(() => {
        expect(screen.getByText(/Queued in Hive/i)).toBeInTheDocument();
      });
      expect(refetch).toHaveBeenCalled();
    });

    it("surfaces API errors from dispatch", async () => {
      api.useAgents.mockReturnValue({ data: { agents: [{ id: "a1", name: "A" }] } });
      api.useDelegations.mockReturnValue({ data: { delegations: [] }, isLoading: false, refetch: vi.fn() });
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        json: async () => ({ error: "blocked" }),
      } as Response);

      render(<DispatchPanel />);
      fireEvent.change(screen.getAllByRole("combobox")[0]!, { target: { value: "a1" } });
      fireEvent.change(screen.getByPlaceholderText(/Task summary/i), { target: { value: "x" } });
      fireEvent.click(screen.getByRole("button", { name: "Dispatch" }));
      await waitFor(() => expect(screen.getByText("blocked")).toBeInTheDocument());
    });
  });

  describe("NodeDetailRail", () => {
    it("suppresses navigation CTA on flow sources", () => {
      render(<NodeDetailRail nodeId="src:telegram" node={{ label: "Telegram", sub: "ingress" }} />);
      expect(screen.getByText(/Already on map/i)).toBeInTheDocument();
    });

    it("links structural nodes to their routes", () => {
      render(<NodeDetailRail nodeId="memory" />);
      expect(screen.getByRole("link", { name: "Open page" })).toHaveAttribute("href", "/notebooks");
    });
  });

  describe("Library HealthPanel", () => {
    it("flags missing meeting collections", () => {
      render(
        <LibraryHealthPanel
          totalFiles={12}
          collections={[
            { name: "general", docCount: 20, lastUpdated: new Date().toISOString() },
            { name: "meet-recordings", docCount: 4, lastUpdated: new Date().toISOString() },
          ]}
        />,
      );
      expect(screen.getByText(/Meeting \+ Call Recordings/i)).toBeInTheDocument();
      expect(screen.getByText(/4 files indexed/i)).toBeInTheDocument();
    });
  });

  describe("Cookbooks HealthPanel", () => {
    it("renders budget watch state and untracked coverage", () => {
      render(
        <CookbooksHealthPanel
          totalSkills={10}
          coverageGaps={["gap-a"]}
          coverageTelemetryStatus="untracked"
          failuresByAgent={{ ops: 2 }}
          failuresByErrorType={{ timeout: 1 }}
          lastUpdated={null}
          staleCandidates={1}
          skillBudget={{
            status: "watch",
            budgetTokens: 1000,
            metadataTokens: 800,
            metadataChars: 4000,
            utilization: 0.8,
            uniqueSkills: 5,
            averageDescriptionChars: 120,
            recommendations: ["trim descriptions"],
          }}
        />,
      );
      expect(screen.getByText(/Never/)).toBeInTheDocument();
      expect(screen.getByText(/trim descriptions/i)).toBeInTheDocument();
    });
  });

  describe("Savings and Waste panels", () => {
    it("renders savings sparkline when model usage is live", () => {
      api.useModelUsage.mockReturnValue({
        data: {
          usage: {
            models: [{ totalTokens: 100 }, { totalTokens: 200 }],
            total: { requests: 5, inputTokens: 1, outputTokens: 2, cacheRead: 0 },
          },
        },
        isLoading: false,
        isError: false,
      });
      render(<Savings />);
      expect(screen.getByTestId("spark")).toBeInTheDocument();
    });

    it("Waste panel marks source failures as error state", () => {
      api.useHiveFeed.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error("hive down") });
      api.useDelegations.mockReturnValue({ data: { delegations: [] }, isLoading: false, isError: false });
      api.useSkills.mockReturnValue({
        data: { skillBudget: { duplicateSkills: [] }, coverageGaps: [] },
        isLoading: false,
        isError: false,
      });
      render(<Waste filters={{ window: "24h", workspace: "all" }} />);
      expect(screen.getAllByText(/hive down|Failed to load/i).length).toBeGreaterThan(0);
    });
  });
});
