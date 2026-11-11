/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  lastNodes: [] as Array<{ id: string; type?: string; hidden?: boolean; parentId?: string; data: Record<string, unknown> }>,
  lastEdges: [] as Array<{ id: string; style?: { stroke?: unknown } }>,
}));

vi.mock("@xyflow/react", () => ({
  ReactFlow: ({
    nodes,
    edges,
    onNodeClick,
    nodeTypes,
  }: {
    nodes?: Array<{ id: string; type?: string; hidden?: boolean; parentId?: string; data: Record<string, unknown> }>;
    edges?: Array<{ id: string; style?: { stroke?: unknown } }>;
    onNodeClick?: (event: React.MouseEvent, node: { id: string; type?: string; data: Record<string, unknown> }) => void;
    nodeTypes?: Record<string, React.ComponentType<{ data: Record<string, unknown> }>>;
  }) => {
    captured.lastNodes = nodes ?? [];
    captured.lastEdges = edges ?? [];
    return (
      <div data-testid="react-flow-batch26">
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

describe("ReactFlowCanvas batch26", () => {
  it("maps non-A2A agents to dormant status and generic initials", () => {
    const onNodeClick = vi.fn();
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
            id: "idle-batch26",
            name: "Open Claw Batch26",
            status: "idle",
            latencyMs: 4,
            location: "remote",
            protocol: "http",
            platform: "openclaw",
            metadata: { a2a: { source: "custom" } },
          },
        ]}
        onNodeClick={onNodeClick}
      />,
    );

    const agentNode = captured.lastNodes.find((n) => n.id === "agent-idle-batch26");
    expect(agentNode?.data.status).toBe("dormant");
    expect(screen.getByText("Oc")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Open Claw Batch26"));
    expect(onNodeClick).toHaveBeenCalledWith(
      "agent-idle-batch26",
      "Open Claw Batch26",
      "Oc",
      expect.objectContaining({ Protocol: "http", Source: "custom" }),
    );
  });

  it("marks service-down nodes as error and routes local-agents stats", () => {
    const onNodeClick = vi.fn();
    render(
      <ReactFlowCanvas
        services={[{ service: "Agents", status: "down" }]}
        agentCount={0}
        activeCount={0}
        memoryCount={0}
        knowledgeCount={0}
        skillCount={0}
        nodeActivity={{}}
        registeredAgents={[]}
        localActiveCount={3}
        localTotalCount={9}
        onNodeClick={onNodeClick}
      />,
    );

    const gatewayNode = captured.lastNodes.find((n) => n.id === "gateways");
    expect(gatewayNode?.data.status).toBe("error");
    fireEvent.click(screen.getByText("3 Active"));
    expect(onNodeClick).toHaveBeenCalledWith("local-agents", "3 Active", "CLI", {});
  });

  it("expands a collapsed dev-tools group after toggling twice", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "toggle-group-devtools" }));
    const hiddenDevTools = captured.lastNodes.filter((n) => n.parentId === "group-devtools" && n.hidden);
    expect(hiddenDevTools.length).toBe(0);
    expect(screen.getByText(/Mini view/i)).toBeInTheDocument();
  });
});
