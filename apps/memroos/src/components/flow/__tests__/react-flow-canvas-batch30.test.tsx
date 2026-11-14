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
      <div data-testid="react-flow-batch30">
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

import { ReactFlowCanvas } from "../react-flow-canvas";

describe("ReactFlowCanvas batch30", () => {
  it("getStatus maps service health and node activity branches (lines 434–442)", () => {
    render(
      <ReactFlowCanvas
        services={[
          { service: "QMD", status: "down" },
          { service: "mem0", status: "up" },
        ]}
        agentCount={2}
        activeCount={1}
        memoryCount={3}
        knowledgeCount={2}
        skillCount={1}
        nodeActivity={{ notebooks: 2, librarian: 90, gateways: 45 }}
        registeredAgents={[
          {
            id: "idle-b30",
            name: "Idle B30",
            status: "idle",
            latencyMs: 1,
            location: "local",
            platform: "codex",
          },
        ]}
        onNodeClick={vi.fn()}
      />,
    );

    const librarian = captured.lastNodes.find((n) => n.id === "librarian");
    const notebooks = captured.lastNodes.find((n) => n.id === "notebooks");
    const gateways = captured.lastNodes.find((n) => n.id === "gateways");
    const agentNode = captured.lastNodes.find((n) => n.id === "agent-idle-b30");
    expect(librarian?.data.status).toBe("error");
    expect(notebooks?.data.status).toBe("active");
    expect(gateways?.data.status).toBe("idle");
    expect(agentNode?.data.status).toBe("dormant");
    expect(screen.getByText(/Mini view/i)).toBeInTheDocument();
  });

  it("mini overview still renders after collapsing grouped agents (absoluteNodePosition line 300)", () => {
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
            id: "collapse-b30",
            name: "Collapse B30",
            status: "active",
            latencyMs: 1,
            location: "local",
            platform: "codex",
          },
        ]}
        onNodeClick={vi.fn()}
      />,
    );

    expect(screen.getByText(/Mini view/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "toggle-group-agents" }));
    expect(captured.lastNodes.filter((n) => n.parentId === "group-agents" && n.hidden).length).toBeGreaterThan(0);
    expect(screen.getByText(/Mini view/i)).toBeInTheDocument();
  });
});
