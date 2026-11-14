/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const captured = vi.hoisted(() => ({
  lastNodes: [] as Array<{
    id: string;
    type?: string;
    hidden?: boolean;
    parentId?: string;
    data: Record<string, unknown>;
    position?: { x: number; y: number };
  }>,
  lastEdges: [] as Array<{ id: string; source: string; target: string; style?: { stroke?: unknown } }>,
}));

vi.mock("@xyflow/react", () => ({
  ReactFlow: ({
    nodes,
    edges,
    onNodeClick,
    nodeTypes,
  }: {
    nodes?: typeof captured.lastNodes;
    edges?: typeof captured.lastEdges;
    onNodeClick?: (event: React.MouseEvent, node: { id: string; type?: string; data: Record<string, unknown> }) => void;
    nodeTypes?: Record<string, React.ComponentType<{ data: Record<string, unknown> }>>;
  }) => {
    captured.lastNodes = nodes ?? [];
    captured.lastEdges = edges ?? [];
    return (
      <div data-testid="react-flow-batch35">
        {nodes?.map((node) => {
          if (node.hidden) return null;
          if (node.type === "groupBoxNode") {
            return (
              <div key={node.id}>
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

import { ReactFlowCanvas } from "../react-flow-canvas";

describe("ReactFlowCanvas batch35", () => {
  it("getStatus honors registered agentStatus active vs dormant (stmt 434)", () => {
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
            id: `active-b35-${suffix}`,
            name: `Active B35 ${suffix}`,
            status: "active",
            latencyMs: 1,
            location: "local",
            platform: "claude",
          },
          {
            id: `idle-b35-${suffix}`,
            name: `Idle B35 ${suffix}`,
            status: "idle",
            latencyMs: 1,
            location: "local",
            platform: "claude",
          },
        ]}
        onNodeClick={vi.fn()}
      />,
    );
    const activeNode = captured.lastNodes.find((n) => n.id === `agent-active-b35-${suffix}`);
    const idleNode = captured.lastNodes.find((n) => n.id === `agent-idle-b35-${suffix}`);
    expect(activeNode?.data.status).toBe("active");
    expect(idleNode?.data.status).toBe("dormant");
  });

  it("MiniOverview renders edge strokes and survives parent chain resolution (stmts 300, 321)", () => {
    render(
      <ReactFlowCanvas
        services={[]}
        agentCount={1}
        activeCount={0}
        memoryCount={2}
        knowledgeCount={1}
        skillCount={1}
        nodeActivity={{ output: 120 }}
        registeredAgents={[]}
        onNodeClick={vi.fn()}
      />,
    );
    expect(screen.getByText(/Mini view/i)).toBeInTheDocument();
    expect(captured.lastEdges.length).toBeGreaterThan(0);
    const styled = captured.lastEdges.find((e) => typeof e.style?.stroke === "string");
    expect(styled?.style?.stroke).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "toggle-group-devtools" }));
    expect(captured.lastNodes.find((n) => n.id === "gitnexus")).toBeTruthy();
  });

  it("nodeStats default branch returns empty object for unknown ids", () => {
    const onNodeClick = vi.fn();
    render(
      <ReactFlowCanvas
        services={[]}
        agentCount={0}
        activeCount={0}
        memoryCount={0}
        knowledgeCount={0}
        skillCount={0}
        nodeActivity={{}}
        registeredAgents={[]}
        onNodeClick={onNodeClick}
      />,
    );
    const custom = captured.lastNodes.find((n) => n.id === "custom-b35-node");
    expect(custom).toBeFalsy();
    const request = captured.lastNodes.find((n) => n.id === "request");
    fireEvent.click(screen.getByText(String(request?.data.label)));
    expect(onNodeClick).toHaveBeenCalled();
  });
});
