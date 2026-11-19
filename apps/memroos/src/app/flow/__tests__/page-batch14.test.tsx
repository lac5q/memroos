/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/api-client", () => ({
  useHealth: () => ({ data: { services: [] } }),
  useAgents: () => ({ data: { agents: [] } }),
  useKnowledge: () => ({ data: { totalDocs: 0 } }),
  useMemory: () => ({ data: { claude: [] } }),
  useActivity: () => ({ data: { nodeActivity: {}, events: [] } }),
  useSkills: () => ({ data: { totalSkills: 0, coverageGaps: [], failuresByAgent: {} } }),
  usePaperclipFleet: () => ({ data: undefined, isLoading: false }),
  useToolAttention: () => ({ data: undefined }),
}));

vi.mock("@/components/flow/react-flow-canvas", () => ({
  ReactFlowCanvas: () => <div data-testid="react-flow-canvas">flow</div>,
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
  NodeDetailPanel: () => null,
}));

vi.mock("@/components/voice/VoicePanel", () => ({
  VoicePanel: () => null,
}));

import FlowPage from "../page";

describe("FlowPage batch14", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("switches from topology to react flow canvas", () => {
    render(<FlowPage />);
    fireEvent.click(screen.getByRole("button", { name: "Open in Flow" }));
    expect(screen.getByTestId("react-flow-canvas")).toBeInTheDocument();
  });
});
