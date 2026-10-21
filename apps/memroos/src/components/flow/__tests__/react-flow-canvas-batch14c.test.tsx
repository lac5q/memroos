/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  lastNodes: [] as unknown[],
}));

vi.mock("@xyflow/react", () => ({
  ReactFlow: ({
    children,
    onNodeClick,
    nodes,
    nodeTypes,
  }: {
    children?: React.ReactNode;
    onNodeClick?: (event: React.MouseEvent, node: { id: string; type?: string; data: Record<string, unknown> }) => void;
    nodes?: Array<{ id: string; type?: string; data: Record<string, unknown>; hidden?: boolean }>;
    nodeTypes?: Record<string, React.ComponentType<{ data: Record<string, unknown> }>>;
  }) => {
    captured.lastNodes = nodes ?? [];
    return (
      <div data-testid="react-flow">
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
        {children}
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

const baseProps = {
  services: [] as Array<{ service: string; status: "up" | "down" }>,
  agentCount: 1,
  activeCount: 1,
  memoryCount: 10,
  knowledgeCount: 5,
  skillCount: 2,
  nodeActivity: {} as Record<string, number>,
  registeredAgents: [] as Array<{
    id: string;
    name: string;
    status: string;
    latencyMs: number | null;
    location: string;
  }>,
  onNodeClick: vi.fn(),
};

describe("ReactFlowCanvas batch14c", () => {
  it("marks request node active when activity is under five minutes", () => {
    render(<ReactFlowCanvas {...baseProps} nodeActivity={{ request: 2 }} onNodeClick={vi.fn()} />);
    const requestNode = (captured.lastNodes as Array<{ id: string; data: { status?: string } }>).find(
      (n) => n.id === "request",
    );
    expect(requestNode?.data.status).toBe("active");
  });

  it("ignores group box clicks in handleNodeClick", () => {
    const onNodeClick = vi.fn();
    render(<ReactFlowCanvas {...baseProps} onNodeClick={onNodeClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Dev Tools" }));
    expect(onNodeClick).not.toHaveBeenCalled();
  });

  it("includes top failure agent on cookbooks node stats", () => {
    const onNodeClick = vi.fn();
    render(
      <ReactFlowCanvas
        {...baseProps}
        topFailureAgent="fail-agent"
        onNodeClick={onNodeClick}
      />,
    );
    fireEvent.click(screen.getByText("Skills"));
    expect(onNodeClick).toHaveBeenCalledWith(
      "cookbooks",
      "Skills",
      expect.any(String),
      expect.objectContaining({ "Top Failure": "fail-agent" }),
    );
  });
});
