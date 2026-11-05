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
      <div data-testid="react-flow-batch27">
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
          return (
            <button key={node.id} type="button" onClick={(event) => onNodeClick?.(event, node)}>
              {String(node.data.label ?? node.id)}
            </button>
          );
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

describe("ReactFlowCanvas batch27", () => {
  it("maps active registered agents to active status in the canvas", () => {
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
            id: "active-batch27",
            name: "Active Batch27",
            status: "active",
            latencyMs: 2,
            location: "local",
            platform: "codex",
          },
        ]}
        onNodeClick={vi.fn()}
      />,
    );

    const agentNode = captured.lastNodes.find((n) => n.id === "agent-active-batch27");
    expect(agentNode?.data.status).toBe("active");
    expect(screen.getByText("Active Batch27")).toBeInTheDocument();
  });

  it("renders mini overview with flow edges between topology nodes", () => {
    render(
      <ReactFlowCanvas
        services={[{ service: "QMD", status: "up" }]}
        agentCount={0}
        activeCount={0}
        memoryCount={1}
        knowledgeCount={1}
        skillCount={1}
        nodeActivity={{ librarian: 2 }}
        registeredAgents={[]}
        onNodeClick={vi.fn()}
      />,
    );

    expect(screen.getByText(/Mini view/i)).toBeInTheDocument();
    expect(captured.lastEdges.length).toBeGreaterThan(0);
    expect(captured.lastEdges.every((edge) => edge.source && edge.target)).toBe(true);
  });

  it("collapses the dev-tools group and toggles it back open", () => {
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
        onNodeClick={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "toggle-group-devtools" }));
    expect(captured.lastNodes.filter((n) => n.parentId === "group-devtools" && n.hidden).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "toggle-group-devtools" }));
    expect(captured.lastNodes.filter((n) => n.parentId === "group-devtools" && n.hidden).length).toBe(0);
  });
});
