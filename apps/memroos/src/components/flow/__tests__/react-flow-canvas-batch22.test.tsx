/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  onNodeClickHandler: null as
    | ((event: React.MouseEvent, node: { id: string; type?: string; data: Record<string, unknown> }) => void)
    | null,
  lastNodes: [] as unknown[],
}));

vi.mock("@xyflow/react", () => ({
  ReactFlow: ({
    onNodeClick,
    nodes,
    nodeTypes,
  }: {
    onNodeClick?: (event: React.MouseEvent, node: { id: string; type?: string; data: Record<string, unknown> }) => void;
    nodes?: Array<{ id: string; type?: string; data: Record<string, unknown>; hidden?: boolean }>;
    nodeTypes?: Record<string, React.ComponentType<{ data: Record<string, unknown> }>>;
  }) => {
    captured.onNodeClickHandler = onNodeClick ?? null;
    captured.lastNodes = nodes ?? [];
    return (
      <div data-testid="react-flow">
        <button
          type="button"
          data-testid="simulate-agents-node-click"
          onClick={(event) =>
            onNodeClick?.(event, {
              id: "agents",
              type: "flowNode",
              data: { label: "Agents", icon: "Ag" },
            })
          }
        >
          Sim agents
        </button>
        <button
          type="button"
          data-testid="simulate-group-click"
          onClick={(event) =>
            onNodeClick?.(event, {
              id: "group-agents",
              type: "groupBoxNode",
              data: { label: "Server Agents" },
            })
          }
        >
          Sim group via handler
        </button>
        {nodes?.map((node) => {
          if (node.type === "groupBoxNode") {
            return (
              <button
                key={node.id}
                type="button"
                onClick={() => {
                  const toggle = node.data.onToggleCollapse as (() => void) | undefined;
                  toggle?.();
                }}
              >
                {String(node.data.label)}
              </button>
            );
          }
          const NodeComponent = node.type ? nodeTypes?.[node.type] : undefined;
          if (NodeComponent) {
            return (
              <div
                key={node.id}
                data-node-id={node.id}
                onClick={(event) => onNodeClick?.(event, node)}
                role="button"
                tabIndex={0}
              >
                <NodeComponent data={node.data} />
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

describe("ReactFlowCanvas batch22", () => {
  it("ignores groupBoxNode in handleNodeClick and maps agents node stats", () => {
    const onNodeClick = vi.fn();
    render(
      <ReactFlowCanvas
        services={[
          { service: "Agents", status: "up" },
          { service: "Paperclip", status: "down" },
        ]}
        agentCount={9}
        activeCount={4}
        memoryCount={1}
        knowledgeCount={1}
        skillCount={1}
        nodeActivity={{ gateways: 12 }}
        registeredAgents={[
          {
            id: "worker-1",
            name: "Worker",
            status: "active",
            latencyMs: 1,
            location: "local",
            platform: "codex",
          },
        ]}
        onNodeClick={onNodeClick}
      />,
    );

    fireEvent.click(screen.getByTestId("simulate-group-click"));
    expect(onNodeClick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("simulate-agents-node-click"));
    expect(onNodeClick).toHaveBeenCalledWith(
      "agents",
      "Agents",
      "Ag",
      expect.objectContaining({ Total: 9, Active: 4 }),
    );

    const nodes = captured.lastNodes as Array<{ id: string; data: { status?: string } }>;
    expect(nodes.find((n) => n.id === "gateways")?.data.status).toBe("idle");
    expect(nodes.find((n) => n.id === "manager")?.data.status).toBe("error");
  });

  it("renders mini overview edges when child nodes are visible", () => {
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
    expect(screen.getByText(/Mini view/i)).toBeInTheDocument();
    expect(captured.onNodeClickHandler).toBeTruthy();
  });
});
