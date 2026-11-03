/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  lastNodes: [] as Array<{ id: string; hidden?: boolean; data: Record<string, unknown> }>,
}));

vi.mock("@xyflow/react", () => ({
  ReactFlow: ({
    nodes,
    onNodeClick,
  }: {
    nodes?: Array<{ id: string; type?: string; hidden?: boolean; data: Record<string, unknown> }>;
    onNodeClick?: (event: React.MouseEvent, node: { id: string; type?: string; data: Record<string, unknown> }) => void;
  }) => {
    captured.lastNodes = nodes ?? [];
    return (
      <div data-testid="react-flow-batch22b">
        {nodes?.map((node) =>
          node.hidden ? null : (
            <button
              key={node.id}
              type="button"
              onClick={(event) => onNodeClick?.(event, node)}
            >
              {String(node.data.label ?? node.id)}
            </button>
          ),
        )}
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

describe("ReactFlowCanvas batch22b", () => {
  it("routes memory and knowledge node clicks with counts", () => {
    const onNodeClick = vi.fn();
    render(
      <ReactFlowCanvas
        services={[{ service: "Mem0", status: "degraded" }]}
        agentCount={2}
        activeCount={1}
        memoryCount={11}
        knowledgeCount={22}
        skillCount={3}
        nodeActivity={{ memory: 5 }}
        registeredAgents={[]}
        onNodeClick={onNodeClick}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "mem0" }));
    expect(onNodeClick).toHaveBeenCalledWith(
      "notebooks",
      "mem0",
      expect.any(String),
      expect.objectContaining({ Entries: 11 }),
    );

    fireEvent.click(screen.getByRole("button", { name: "LLM Wiki" }));
    expect(onNodeClick).toHaveBeenLastCalledWith(
      "llmwiki",
      "LLM Wiki",
      expect.any(String),
      expect.any(Object),
    );

    const mem0Node = captured.lastNodes.find((n) => n.id === "notebooks");
    expect(mem0Node?.data.status).toBeDefined();
  });
});
