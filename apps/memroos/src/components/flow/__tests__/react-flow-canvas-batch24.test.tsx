/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  lastNodes: [] as Array<{ id: string; parentId?: string; hidden?: boolean; type?: string; data: Record<string, unknown>; position?: { x: number; y: number } }>,
}));

vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ nodes, onNodeClick }: {
    nodes?: Array<{ id: string; parentId?: string; hidden?: boolean; type?: string; data: Record<string, unknown>; position?: { x: number; y: number } }>;
    onNodeClick?: (event: React.MouseEvent, node: { id: string; type?: string; data: Record<string, unknown> }) => void;
  }) => {
    captured.lastNodes = nodes ?? [];
    return (
      <div data-testid="react-flow-batch24">
        {nodes?.map((node) =>
          node.hidden ? null : (
            <button key={node.id} type="button" onClick={(event) => onNodeClick?.(event, node)}>
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

describe("ReactFlowCanvas batch24", () => {
  it("marks active registered agents and renders nested mini overview nodes", () => {
    render(
      <ReactFlowCanvas
        services={[{ service: "QMD", status: "up" }]}
        agentCount={2}
        activeCount={2}
        memoryCount={1}
        knowledgeCount={1}
        skillCount={1}
        nodeActivity={{ librarian: 1 }}
        registeredAgents={[
          {
            id: "active-batch24",
            name: "Active Batch24",
            status: "active",
            latencyMs: 1,
            location: "local",
            platform: "codex",
          },
        ]}
        onNodeClick={vi.fn()}
      />,
    );

    const agentNode = captured.lastNodes.find((n) => n.id === "agent-active-batch24");
    expect(agentNode?.data.status).toBe("active");
    expect(screen.getByText(/Mini view/i)).toBeInTheDocument();
  });

  it("routes cookbooks stats through node click handler", () => {
    const onNodeClick = vi.fn();
    render(
      <ReactFlowCanvas
        services={[]}
        agentCount={0}
        activeCount={0}
        memoryCount={0}
        knowledgeCount={0}
        skillCount={0}
        coverageGapsCount={2}
        topFailureAgent="fail-batch24"
        nodeActivity={{}}
        registeredAgents={[]}
        onNodeClick={onNodeClick}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Skills/i }));
    expect(onNodeClick).toHaveBeenCalledWith(
      "cookbooks",
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ Gaps: 2, "Top Failure": "fail-batch24" }),
    );
  });
});
