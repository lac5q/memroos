/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  lastNodes: [] as Array<{ id: string; parentId?: string; hidden?: boolean; data: Record<string, unknown> }>,
}));

vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ nodes, onNodeClick }: {
    nodes?: Array<{ id: string; parentId?: string; hidden?: boolean; type?: string; data: Record<string, unknown> }>;
    onNodeClick?: (event: React.MouseEvent, node: { id: string; type?: string; data: Record<string, unknown> }) => void;
  }) => {
    captured.lastNodes = nodes ?? [];
    return (
      <div data-testid="react-flow-batch23">
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

describe("ReactFlowCanvas batch23", () => {
  it("marks dormant registered agents and routes cookbooks stats with top failure", () => {
    const onNodeClick = vi.fn();
    render(
      <ReactFlowCanvas
        services={[{ service: "QMD", status: "up" }]}
        agentCount={1}
        activeCount={0}
        memoryCount={2}
        knowledgeCount={3}
        skillCount={4}
        coverageGapsCount={1}
        topFailureAgent="agent-batch23"
        nodeActivity={{ librarian: 12 }}
        registeredAgents={[
          {
            id: "worker-batch23",
            name: "Worker Batch23",
            status: "idle",
            latencyMs: 1,
            location: "local",
            platform: "codex",
          },
        ]}
        onNodeClick={onNodeClick}
      />,
    );

    const agentNode = captured.lastNodes.find((n) => n.id === "agent-worker-batch23");
    expect(agentNode?.data.status).toBe("dormant");

    fireEvent.click(screen.getByRole("button", { name: /Skills/i }));
    expect(onNodeClick).toHaveBeenCalledWith(
      "cookbooks",
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ "Top Failure": "agent-batch23", Gaps: 1 }),
    );
  });

  it("renders mini overview for the flow canvas", () => {
    render(
      <ReactFlowCanvas
        services={[]}
        agentCount={0}
        activeCount={0}
        memoryCount={0}
        knowledgeCount={0}
        skillCount={0}
        nodeActivity={{ librarian: 8 }}
        registeredAgents={[]}
        onNodeClick={vi.fn()}
      />,
    );
    expect(screen.getByText(/Mini view/i)).toBeInTheDocument();
  });
});
