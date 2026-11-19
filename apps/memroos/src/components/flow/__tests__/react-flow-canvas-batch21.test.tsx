/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@xyflow/react", () => ({
  ReactFlow: ({
    onNodeClick,
    nodes,
    nodeTypes,
  }: {
    onNodeClick?: (event: React.MouseEvent, node: { id: string; type?: string; data: Record<string, unknown> }) => void;
    nodes?: Array<{ id: string; type?: string; data: Record<string, unknown> }>;
    nodeTypes?: Record<string, React.ComponentType<{ data: Record<string, unknown> }>>;
  }) => (
    <div data-testid="react-flow">
      {nodes?.map((node) => {
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
          <button key={node.id} type="button" data-node-id={node.id} onClick={(event) => onNodeClick?.(event, node)}>
            {String(node.data.label ?? node.id)}
          </button>
        );
      })}
    </div>
  ),
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  BackgroundVariant: { Dots: "dots" },
}));

vi.mock("@xyflow/react/dist/style.css", () => ({}));

import { ReactFlowCanvas } from "../react-flow-canvas";

describe("ReactFlowCanvas batch21", () => {
  it("returns gateway registration stats when the gateways node is clicked", () => {
    const onNodeClick = vi.fn();
    render(
      <ReactFlowCanvas
        services={[]}
        agentCount={5}
        activeCount={2}
        memoryCount={10}
        knowledgeCount={20}
        skillCount={3}
        nodeActivity={{}}
        registeredAgents={[]}
        onNodeClick={onNodeClick}
      />,
    );

    fireEvent.click(screen.getByText("Gateways"));
    expect(onNodeClick).toHaveBeenCalledWith(
      "gateways",
      "Gateways",
      expect.any(String),
      expect.objectContaining({ Registered: 5, Active: 2 }),
    );
  });
});
