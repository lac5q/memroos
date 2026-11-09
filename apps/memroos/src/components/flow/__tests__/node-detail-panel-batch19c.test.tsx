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
    <div data-testid="paperclip-fleet">{isLoading ? "loading" : "ready"}</div>
  ),
}));

import { NodeDetailPanel } from "../node-detail-panel";
import { useSkills, useToolAttention } from "@/lib/api-client";

const DEFAULT_PROPS = {
  nodeLabel: "Manager",
  nodeIcon: "🧭",
  nodeStats: { Agents: 2 },
  events: [],
  onClose: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    }),
  );
  vi.mocked(useSkills).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
  } as ReturnType<typeof useSkills>);
  vi.mocked(useToolAttention).mockReturnValue({
    data: {
      summary: {
        totalCapabilities: 9,
        topLevelTools: 4,
        workspaces: 2,
        recentOutcomes: 7,
      },
      recommendations: [],
    },
    isLoading: false,
    isError: false,
  } as ReturnType<typeof useToolAttention>);
});

describe("NodeDetailPanel batch19c", () => {
  it("renders tool-gateway live stats from tool attention data", () => {
    render(<NodeDetailPanel {...DEFAULT_PROPS} nodeId="tool-gateway" nodeLabel="Tools" />);
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("Capabilities")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("renders manager fleet panel and tolerates heartbeat HTTP failures", async () => {
    render(
      <NodeDetailPanel
        {...DEFAULT_PROPS}
        nodeId="manager"
        paperclipFleet={{ summary: { fleetStatus: "active" }, agents: [], operations: [], timestamp: "t" }}
        paperclipLoading={false}
      />,
    );
    expect(screen.getByTestId("paperclip-fleet")).toHaveTextContent("ready");
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getByText("Node Activity")).toBeInTheDocument();
  });
});
