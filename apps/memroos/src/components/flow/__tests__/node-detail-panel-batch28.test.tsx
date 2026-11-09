/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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
  SkillHeatmap: ({ contributionHistory }: { contributionHistory: unknown[] }) => (
    <div data-testid="skill-heatmap-batch28">{contributionHistory.length}</div>
  ),
}));

vi.mock("../paperclip-fleet-panel", () => ({
  PaperclipFleetPanel: () => null,
}));

import { NodeDetailPanel } from "../node-detail-panel";
import { useSkills, useToolAttention } from "@/lib/api-client";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useSkills).mockReturnValue({
    data: { contributionHistory: [{ day: "2026-06-01", count: 2 }] },
    isLoading: false,
    isError: false,
  } as ReturnType<typeof useSkills>);
  vi.mocked(useToolAttention).mockReturnValue({
    data: {
      recommendations: [],
      summary: {
        totalCapabilities: 0,
        topLevelTools: 0,
        workspaces: 0,
        recentOutcomes: 0,
      },
    },
    isLoading: false,
    isError: false,
  } as ReturnType<typeof useToolAttention>);
});

describe("NodeDetailPanel batch28 — sparse activity and tool gateway empty state", () => {
  it("shows limited-activity copy for sparse topology nodes", () => {
    render(
      <NodeDetailPanel
        nodeId="qdrant"
        nodeLabel="Memory Core"
        nodeIcon="MC"
        nodeStats={{}}
        events={[]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("limited-activity-data")).toBeInTheDocument();
  });

  it("renders cookbooks heatmap and empty tool-gateway recommendations", () => {
    const { rerender } = render(
      <NodeDetailPanel
        nodeId="cookbooks"
        nodeLabel="Cookbooks"
        nodeIcon="CB"
        nodeStats={{}}
        events={[]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("skill-heatmap-batch28")).toHaveTextContent("1");

    rerender(
      <NodeDetailPanel
        nodeId="tool-gateway"
        nodeLabel="Tool Gateway"
        nodeIcon="TG"
        nodeStats={{}}
        events={[]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("No recommendations available")).toBeInTheDocument();
  });
});
