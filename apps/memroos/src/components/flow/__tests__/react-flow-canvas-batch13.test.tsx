import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  onNodeClick: vi.fn(),
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
    nodes?: Array<{ id: string; type?: string; data: Record<string, unknown> }>;
    nodeTypes?: Record<string, React.ComponentType<{ data: Record<string, unknown> }>>;
  }) => {
    captured.lastNodes = nodes ?? [];
    return (
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
            <button
              key={node.id}
              type="button"
              data-node-id={node.id}
              onClick={(event) => onNodeClick?.(event, node)}
            >
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

describe("ReactFlowCanvas batch13 coverage", () => {
  it("derives idle/error infra statuses from activity and health", () => {
    const onNodeClick = vi.fn();
    render(
      <ReactFlowCanvas
        services={[{ service: "Paperclip", status: "down" }]}
        agentCount={0}
        activeCount={0}
        memoryCount={0}
        knowledgeCount={0}
        skillCount={0}
        nodeActivity={{ request: 12 }}
        registeredAgents={[]}
        onNodeClick={onNodeClick}
      />,
    );

    const nodes = captured.lastNodes as Array<{ id: string; data: { status?: string } }>;
    expect(nodes.find((n) => n.id === "request")?.data.status).toBe("idle");
    expect(nodes.find((n) => n.id === "manager")?.data.status).toBe("error");
    fireEvent.click(screen.getByText("User / Telegram"));
    expect(onNodeClick).toHaveBeenCalled();
  });

  it("includes streaming ADK metadata in agent stats", () => {
    const onNodeClick = vi.fn();
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
            id: "stream-1",
            name: "Streaming ADK",
            status: "active",
            latencyMs: 20,
            location: "remote",
            protocol: "a2a",
            platform: "adk",
            metadata: {
              a2a: {
                source: "adk",
                streaming: true,
                version: "3.1",
                lastFetchedAt: "2026-07-01",
                latestTaskState: "working",
              },
            },
            currentTask: "sync cards",
          },
        ]}
        onNodeClick={onNodeClick}
      />,
    );

    fireEvent.click(screen.getByText("Streaming ADK"));
    expect(onNodeClick).toHaveBeenCalledWith(
      "agent-stream-1",
      "Streaming ADK",
      expect.any(String),
      expect.objectContaining({
        Source: "ADK",
        Version: "3.1",
        "Latest task": "working",
        "Current task": "sync cards",
      }),
    );

    const agentNode = (captured.lastNodes as Array<{ id: string; data: { subtitle?: string } }>).find(
      (n) => n.id === "agent-stream-1",
    );
    expect(agentNode?.data.subtitle).toContain("streaming");
  });

  it("maps claw-named agents to Oc icon initials", () => {
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
            id: "claw-1",
            name: "My Claw Worker",
            status: "idle",
            latencyMs: null,
            location: "local",
          },
        ]}
        onNodeClick={vi.fn()}
      />,
    );

    const agentNode = (captured.lastNodes as Array<{ id: string; data: { icon?: string } }>).find(
      (n) => n.id === "agent-claw-1",
    );
    expect(agentNode?.data.icon).toBe("Oc");
  });
});
