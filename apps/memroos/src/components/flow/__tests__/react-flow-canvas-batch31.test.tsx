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
      <div data-testid="react-flow-batch31">
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

describe("ReactFlowCanvas batch31", () => {
  it("marks active registered agents as active in node data (line 434)", () => {
    const suffix = randomUUID().slice(0, 8);
    render(
      <ReactFlowCanvas
        services={[]}
        agentCount={1}
        activeCount={1}
        memoryCount={0}
        knowledgeCount={0}
        skillCount={0}
        nodeActivity={{}}
        registeredAgents={[
          {
            id: `active-b31-${suffix}`,
            name: `Active B31 ${suffix}`,
            status: "active",
            latencyMs: 4,
            location: "local",
            platform: "codex",
          },
        ]}
        onNodeClick={vi.fn()}
      />,
    );

    const agentNode = captured.lastNodes.find((n) => n.id === `agent-active-b31-${suffix}`);
    expect(agentNode?.data.status).toBe("active");
    expect(agentNode?.parentId).toBe("group-agents");
    expect(screen.getByText(/Mini view/i)).toBeInTheDocument();
  });

  it("absoluteNodePosition walks parent chain for grouped child nodes (line 300)", () => {
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
            id: `nested-b31-${suffix}`,
            name: `Nested B31 ${suffix}`,
            status: "idle",
            latencyMs: 2,
            location: "local",
            platform: "codex",
          },
        ]}
        onNodeClick={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "toggle-group-agents" }));
    const nested = captured.lastNodes.find((n) => n.id === `agent-nested-b31-${suffix}`);
    expect(nested?.hidden).toBe(true);
    expect(screen.getByText(/Mini view/i)).toBeInTheDocument();
  });
});
