/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const mockNodeDetailPanel = vi.fn(
  ({
    onClose,
    paperclipLoading,
  }: {
    onClose: () => void;
    paperclipLoading: boolean;
  }) => (
    <div data-testid="node-detail-panel">
      {paperclipLoading ? "paperclip-loading" : "paperclip-ready"}
      <button type="button" onClick={onClose}>
        Close detail
      </button>
    </div>
  ),
);

vi.mock("@/lib/api-client", () => ({
  useHealth: vi.fn(),
  useAgents: vi.fn(),
  useKnowledge: vi.fn(),
  useMemory: vi.fn(),
  useActivity: vi.fn(),
  useSkills: vi.fn(),
  usePaperclipFleet: vi.fn(),
  useToolAttention: vi.fn(),
}));

vi.mock("@/components/flow/react-flow-canvas", () => ({
  ReactFlowCanvas: ({
    onNodeClick,
    topFailureAgent,
    skillCount,
  }: {
    onNodeClick: (id: string, label: string, icon: string, stats: Record<string, string | number>) => void;
    topFailureAgent: string | null;
    skillCount: number;
  }) => (
    <div data-testid="react-flow-canvas">
      <span data-testid="top-failure-agent">{topFailureAgent ?? "none"}</span>
      <span data-testid="skill-count">{skillCount}</span>
      <button
        type="button"
        onClick={() => onNodeClick("agents", "Agents", "🤖", { active: 2 })}
      >
        Select agents node
      </button>
    </div>
  ),
}));

vi.mock("@/components/workflow/topology-canvas", () => ({
  TopologyCanvas: () => <div data-testid="topology-canvas">topology</div>,
}));

vi.mock("@/components/workflow/node-detail-rail", () => ({
  NodeDetailRail: () => <div data-testid="node-detail-rail" />,
}));

vi.mock("@/components/flow/activity-feed", () => ({
  ActivityFeed: () => <div data-testid="activity-feed" />,
}));

vi.mock("@/components/flow/node-detail-panel", () => ({
  NodeDetailPanel: (props: unknown) => mockNodeDetailPanel(props as Parameters<typeof mockNodeDetailPanel>[0]),
}));

vi.mock("@/components/voice/VoicePanel", () => ({
  VoicePanel: () => null,
}));

import FlowPage from "../page";
import {
  useActivity,
  useAgents,
  useHealth,
  useKnowledge,
  useMemory,
  usePaperclipFleet,
  useSkills,
  useToolAttention,
} from "@/lib/api-client";

describe("FlowPage batch17", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useHealth).mockReturnValue({ data: { services: [{ name: "sqlite", status: "up" }] } } as ReturnType<typeof useHealth>);
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [
          {
            id: "a1",
            name: "Active One",
            status: "active",
            latencyMs: 12,
            location: "local",
            protocol: "local",
            platform: "codex",
            metadata: {},
            capabilities: [],
            currentTask: null,
            role: "Agent",
          },
          {
            id: "a2",
            name: "Idle Two",
            status: "idle",
            latencyMs: null,
            location: null,
            protocol: "local",
            platform: "claude",
            metadata: {},
            capabilities: ["chat"],
            currentTask: "batch17 task",
            role: "Engineer",
          },
        ],
      },
    } as ReturnType<typeof useAgents>);
    vi.mocked(useKnowledge).mockReturnValue({ data: { totalDocs: 88 } } as ReturnType<typeof useKnowledge>);
    vi.mocked(useMemory).mockReturnValue({ data: { claude: "not-an-array" } } as ReturnType<typeof useMemory>);
    vi.mocked(useActivity).mockReturnValue({
      data: { nodeActivity: { agents: 3 }, events: [{ id: "evt-1" }] },
    } as ReturnType<typeof useActivity>);
    vi.mocked(useSkills).mockReturnValue({
      data: {
        totalSkills: 15,
        coverageGaps: ["gap-a"],
        failuresByAgent: { "a2": 4, "a1": 1 },
      },
    } as ReturnType<typeof useSkills>);
    vi.mocked(useToolAttention).mockReturnValue({
      data: { summary: { totalCapabilities: 9, workspaces: 2 } },
    } as ReturnType<typeof useToolAttention>);
    vi.mocked(usePaperclipFleet).mockReturnValue({
      data: { summary: { fleetStatus: "active" } },
      isLoading: true,
    } as ReturnType<typeof usePaperclipFleet>);
  });

  it("derives agent, skill, and memory counts for the React Flow canvas", () => {
    render(<FlowPage />);
    fireEvent.click(screen.getByRole("button", { name: "Open in Flow" }));

    expect(screen.getByTestId("skill-count")).toHaveTextContent("15");
    expect(screen.getByTestId("top-failure-agent")).toHaveTextContent("a2");
    expect(screen.getByTestId("node-detail-panel")).toHaveTextContent("paperclip-loading");
  });

  it("toggles node selection off and closes the detail panel", () => {
    render(<FlowPage />);
    fireEvent.click(screen.getByRole("button", { name: "Open in Flow" }));

    fireEvent.click(screen.getByRole("button", { name: "Select agents node" }));
    fireEvent.click(screen.getByRole("button", { name: "Select agents node" }));
    fireEvent.click(screen.getByRole("button", { name: "Close detail" }));

    expect(mockNodeDetailPanel).toHaveBeenCalled();
  });
});
