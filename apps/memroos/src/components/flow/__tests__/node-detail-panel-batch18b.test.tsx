/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/api-client", () => ({
  useSkills: vi.fn(),
  useToolAttention: vi.fn(),
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/skill-heatmap", () => ({
  SkillHeatmap: () => <div data-testid="skill-heatmap">heatmap</div>,
}));

vi.mock("../paperclip-fleet-panel", () => ({
  PaperclipFleetPanel: ({ isLoading }: { isLoading: boolean }) => (
    <div data-testid="paperclip-fleet">{isLoading ? "loading fleet" : "fleet ready"}</div>
  ),
}));

import { NodeDetailPanel } from "../node-detail-panel";
import { useSkills, useToolAttention } from "@/lib/api-client";

const DEFAULT_PROPS = {
  nodeLabel: "Test Node",
  nodeIcon: "🔧",
  nodeStats: {},
  events: [],
  onClose: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("heartbeat offline b18b")),
  );
  vi.mocked(useSkills).mockReturnValue({
    data: { totalSkills: 0, contributionHistory: [], coverageGaps: [], failuresByAgent: {} },
    isLoading: false,
    isError: false,
  } as ReturnType<typeof useSkills>);
  vi.mocked(useToolAttention).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
  } as ReturnType<typeof useToolAttention>);
});

describe("NodeDetailPanel batch18b", () => {
  it("shows non-sparse empty activity copy for claude nodes", () => {
    render(<NodeDetailPanel {...DEFAULT_PROPS} nodeId="claude" />);
    expect(screen.getByText(/No recent activity for this node/i)).toBeInTheDocument();
  });

  it("renders tool-gateway empty recommendations state", () => {
    vi.mocked(useToolAttention).mockReturnValue({
      data: {
        summary: {
          totalCapabilities: 0,
          topLevelTools: 0,
          workspaces: 0,
          recentOutcomes: 0,
        },
        recommendations: [],
        capabilities: [],
        recentOutcomes: [],
        sources: [],
        health: { status: "ok", catalog: "available", outcomes: "available", messages: [] },
        timestamp: "2026-07-18T12:00:00.000Z",
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useToolAttention>);

    render(<NodeDetailPanel {...DEFAULT_PROPS} nodeId="tool-gateway" nodeLabel="Tool Gateway" />);
    expect(screen.getByText(/No recommendations available/i)).toBeInTheDocument();
  });

  it("renders manager fleet panel when paperclip data is ready", () => {
    render(
      <NodeDetailPanel
        {...DEFAULT_PROPS}
        nodeId="manager"
        paperclipFleet={{
          summary: { fleetStatus: "online", activeAgents: 1, operations: 0 },
          agents: [],
          operations: [],
          timestamp: "2026-07-18T12:00:00.000Z",
        }}
        paperclipLoading={false}
      />,
    );
    expect(screen.getByTestId("paperclip-fleet")).toHaveTextContent("fleet ready");
  });

  it("swallows heartbeat fetch failures without crashing", async () => {
    render(<NodeDetailPanel {...DEFAULT_PROPS} nodeId="codex" />);
    await waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });
    expect(screen.queryByText(/heartbeat offline b18b/)).not.toBeInTheDocument();
  });
});
