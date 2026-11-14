import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/api-client", () => ({
  useCacheStats: vi.fn(),
  usePurgeCacheMutation: vi.fn(),
  useToolAttention: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("recharts", () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: ({ content }: { content?: React.ReactElement }) =>
    content
      ? React.cloneElement(content, {
          active: true,
          label: "Mon",
          payload: [{ value: 1234567 }],
        })
      : null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: () => null,
  Cell: () => null,
  Legend: () => null,
}));

import { AgentLivenessBadge } from "@/components/agents/agent-liveness-badge";
import { UserMenu } from "@/components/layout/user-menu";
import { CacheHealthPanel } from "@/components/performance/cache-health-panel";
import { ToolAttentionPanel } from "@/components/cookbooks/tool-attention-panel";
import { CostCalculator } from "@/components/ledger/cost-calculator";
import { TimeSeriesChart } from "@/components/shared/time-series-chart";
import { useCacheStats, usePurgeCacheMutation, useToolAttention } from "@/lib/api-client";
import type { MetricEnvelope } from "@/lib/metric-status";

describe("Long-tail components batch13", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    document.cookie = "";
  });

  it("AgentLivenessBadge formats invalid observed timestamps", () => {
    const original = Date.prototype.toLocaleString;
    Date.prototype.toLocaleString = function toLocaleString() {
      if (this.toString() === "Invalid Date") {
        throw new Error("bad locale");
      }
      return original.call(this);
    };

    render(
      <AgentLivenessBadge
        showObserved
        observation={{
          state: "stale",
          observedAt: "not-a-date",
          source: "/api/agents",
          freshnessMs: 9000,
          reason: "heartbeat delayed",
        }}
      />,
    );
    expect(screen.getByText(/not-a-date/)).toBeInTheDocument();
    Date.prototype.toLocaleString = original;
  });

  it("UserMenu applies hover styles on sign out", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "u1",
          email: "ops@example.com",
          displayName: "Ops",
          role: "admin",
        }),
      } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);

    render(<UserMenu />);
    const button = await screen.findByRole("button", { name: "Sign out" });
    fireEvent.mouseEnter(button);
    expect(button.style.background).not.toBe("");
    fireEvent.mouseLeave(button);
    expect(button.style.background).toBe("transparent");
  });

  it("CacheHealthPanel formats megabyte cache usage", () => {
    vi.mocked(usePurgeCacheMutation).mockReturnValue({ mutate: vi.fn(), isPending: false } as never);
    vi.mocked(useCacheStats).mockReturnValue({
      data: {
        stats: { entries: 3, hits: 8, misses: 2, memoryBytes: 2_097_152, invalidations: 1 },
        performance: { ok: true, routes: [{ route: "/api/cache", p95Ms: 12, budgetMs: 50, status: "pass" }] },
      },
      isLoading: false,
    } as never);

    render(<CacheHealthPanel />);
    expect(screen.getByText("2.0 MB")).toBeInTheDocument();
  });

  it("ToolAttentionPanel styles candidate capabilities", () => {
    vi.mocked(useToolAttention).mockReturnValue({
      data: {
        summary: { totalCapabilities: 1, topLevelTools: 0, workspaces: 1, recentOutcomes: 0 },
        capabilities: [
          {
            id: "candidate-1",
            name: "candidate-tool",
            type: "workspace",
            source: "test",
            description: "Candidate capability",
            status: "candidate",
            tags: [],
            useWhen: [],
            topLevel: false,
            loadCommand: "load",
          },
        ],
        recommendations: [],
        health: { status: "ok", catalog: "ok", outcomes: "ok", messages: [] },
        timestamp: "2026-05-21T00:00:00.000Z",
      },
      isLoading: false,
    } as never);

    render(<ToolAttentionPanel />);
    expect(screen.getByText("candidate")).toHaveClass("text-amber-300");
  });

  it("CostCalculator treats invalid rates as zero", () => {
    const envelope: MetricEnvelope<number> = {
      value: 1000,
      status: "live",
      source: "/api/tokens",
      observedAt: null,
      freshnessMs: null,
      scope: { window: "cumulative", workspace: "all" },
      reason: "measured",
    };

    render(
      <CostCalculator totalInput={0} totalOutput={0} tokensSaved={0} savingsEnvelope={envelope} />,
    );

    fireEvent.change(document.querySelector("[data-cost-input-rate]")!, { target: { value: "" } });
    fireEvent.change(document.querySelector("[data-cost-output-rate]")!, { target: { value: "abc" } });
    expect(document.querySelector("[data-cost-spend-card]")?.textContent).toContain("$0.00");
  });

  it("TimeSeriesChart renders active tooltip values", () => {
    render(
      <TimeSeriesChart
        title="Ops"
        points={[{ bucket: "Mon", value: 10 }]}
        window="week"
        onWindowChange={vi.fn()}
      />,
    );
    expect(screen.getByText("1,234,567")).toBeInTheDocument();
  });

});
