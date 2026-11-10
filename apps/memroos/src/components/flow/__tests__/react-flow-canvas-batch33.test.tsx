/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  lastNodes: [] as Array<{
    id: string;
    type?: string;
    hidden?: boolean;
    parentId?: string;
    data: Record<string, unknown>;
    position?: { x: number; y: number };
  }>,
}));

vi.mock("@xyflow/react", () => ({
  ReactFlow: ({
    nodes,
    onNodeClick,
    nodeTypes,
  }: {
    nodes?: typeof captured.lastNodes;
    onNodeClick?: (event: React.MouseEvent, node: { id: string; type?: string; data: Record<string, unknown> }) => void;
    nodeTypes?: Record<string, React.ComponentType<{ data: Record<string, unknown> }>>;
  }) => {
    captured.lastNodes = nodes ?? [];
    return (
      <div data-testid="react-flow-batch33">
        {nodes?.map((node) => {
          if (node.hidden) return null;
          if (node.type === "groupBoxNode") {
            const GroupBox = nodeTypes?.groupBoxNode;
            return (
              <div key={node.id}>
                {GroupBox ? <GroupBox data={node.data} /> : null}
                <button
                  type="button"
                  onClick={() => {
                    const toggle = node.data.onToggleCollapse as (() => void) | undefined;
                    toggle?.();
                  }}
                >
                  toggle-{node.id}
                </button>
              </div>
            );
          }
          const FlowNode = nodeTypes?.flowNode;
          if (FlowNode) {
            return (
              <div key={node.id} role="button" tabIndex={0} onClick={(event) => onNodeClick?.(event, node)}>
                <FlowNode data={node.data} />
              </div>
            );
          }
          return null;
        })}
      </div>
    );
  },
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  BackgroundVariant: { Dots: "dots" },
}));

vi.mock("@xyflow/react/dist/style.css", () => ({}));

import { randomUUID } from "node:crypto";
import { ReactFlowCanvas } from "../react-flow-canvas";

describe("ReactFlowCanvas batch33", () => {
  it("getStatus honors non-active registered agent status (line 434)", () => {
    const suffix = randomUUID().slice(0, 8);
    render(
      <ReactFlowCanvas
        services={[]}
        agentCount={1}
        activeCount={0}
        memoryCount={0}
        knowledgeCount={0}
        skillCount={0}
        nodeActivity={{}}
        registeredAgents={[
          {
            id: `busy-b33-${suffix}`,
            name: `Busy B33 ${suffix}`,
            status: "busy",
            latencyMs: 2,
            location: "local",
            platform: "codex",
          },
        ]}
        onNodeClick={vi.fn()}
      />,
    );

    const agentNode = captured.lastNodes.find((n) => n.id === `agent-busy-b33-${suffix}`);
    expect(agentNode?.data.status).toBe("dormant");
  });

  it("collapsing grouped agents keeps mini overview for remaining static nodes (lines 300, 321)", () => {
    const suffix = randomUUID().slice(0, 8);
    render(
      <ReactFlowCanvas
        services={[]}
        agentCount={1}
        activeCount={0}
        memoryCount={0}
        knowledgeCount={0}
        skillCount={0}
        nodeActivity={{}}
        registeredAgents={[
          {
            id: `collapse-b33-${suffix}`,
            name: `Collapse B33 ${suffix}`,
            status: "idle",
            latencyMs: 1,
            location: "local",
            platform: "codex",
          },
        ]}
        onNodeClick={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "toggle-group-agents" }));
    const hiddenAgent = captured.lastNodes.find((n) => n.id === `agent-collapse-b33-${suffix}`);
    expect(hiddenAgent?.hidden).toBe(true);
    expect(screen.getByText(/Mini view/i)).toBeInTheDocument();
    expect(screen.getByText(/\d+ nodes/)).toBeInTheDocument();
  });
});
