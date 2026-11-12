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
      <div data-testid="react-flow-batch34">
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

import { randomUUID } from "node:crypto";
import { ReactFlowCanvas } from "../react-flow-canvas";

describe("ReactFlowCanvas batch34", () => {
  it("agentStats and agentIcon cover ADK/A2A and qwen name paths (branches 58-59, 118-124)", () => {
    const suffix = randomUUID().slice(0, 8);
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
            id: `adk-b34-${suffix}`,
            name: `ADK B34 ${suffix}`,
            status: "idle",
            latencyMs: 3,
            location: "cloud",
            platform: "google",
            protocol: "a2a",
            metadata: {
              a2a: {
                source: "adk",
                version: "0.4.2",
                streaming: true,
                lastFetchedAt: "2026-06-01T00:00:00.000Z",
                latestTaskState: "working",
              },
            },
            capabilities: [{ id: "c1", name: "tool", description: "", tags: [] }],
            currentTask: "batch34 task",
          },
          {
            id: `qwen-b34-${suffix}`,
            name: `Qwen Worker ${suffix}`,
            status: "idle",
            latencyMs: 1,
            location: "local",
            platform: "qwen",
          },
        ]}
        onNodeClick={onNodeClick}
      />,
    );

    const adkNode = captured.lastNodes.find((n) => n.id === `agent-adk-b34-${suffix}`);
    expect(adkNode?.data.icon).toBe("ADK");
    const qwenNode = captured.lastNodes.find((n) => n.id === `agent-qwen-b34-${suffix}`);
    expect(qwenNode?.data.icon).toBe("Qw");

    fireEvent.click(screen.getByText(`ADK B34 ${suffix}`));
    expect(onNodeClick).toHaveBeenCalled();
    expect(onNodeClick.mock.calls[0]?.[3]).toMatchObject({
      Version: "0.4.2",
      "Latest task": "working",
      "Current task": "batch34 task",
    });
  });

  it("getStatus maps nodeActivity and service health (stmts 300, 321, 434)", () => {
    const suffix = randomUUID().slice(0, 8);
    render(
      <ReactFlowCanvas
        services={[
          { service: "QMD", status: "down" },
          { service: "mem0", status: "up" },
        ]}
        agentCount={0}
        activeCount={0}
        memoryCount={4}
        knowledgeCount={2}
        skillCount={1}
        nodeActivity={{ request: 1, gateways: 45, manager: 90 }}
        highlightedNode="request"
        registeredAgents={[
          {
            id: `idle-b34-${suffix}`,
            name: `Idle B34 ${suffix}`,
            status: "idle",
            latencyMs: 0,
            location: "local",
            platform: "claude",
          },
        ]}
        onNodeClick={vi.fn()}
      />,
    );

    expect(screen.getByText(/Mini view/i)).toBeInTheDocument();
    const librarian = captured.lastNodes.find((n) => n.id === "librarian");
    expect(librarian?.data.status).toBe("error");
    const notebooks = captured.lastNodes.find((n) => n.id === "notebooks");
    expect(notebooks?.data.status).toBe("active");
    const requestNode = captured.lastNodes.find((n) => n.id === "request");
    expect(requestNode?.data.status).toBe("active");

    fireEvent.click(screen.getByRole("button", { name: "toggle-group-agents" }));
    fireEvent.click(screen.getByRole("button", { name: "toggle-group-agents" }));
    expect(captured.lastNodes.find((n) => n.id === `agent-idle-b34-${suffix}`)?.hidden).not.toBe(true);
  });
});
