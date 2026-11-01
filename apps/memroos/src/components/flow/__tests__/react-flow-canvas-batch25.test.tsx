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
      <div data-testid="react-flow-batch25">
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

describe("ReactFlowCanvas batch25", () => {
  it("maps A2A ADK agent metadata into click stats and subtitles", () => {
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
            id: "adk-batch25",
            name: "Gemini Hermes Batch25",
            status: "active",
            latencyMs: 2,
            location: "remote",
            protocol: "a2a",
            platform: "gemini",
            currentTask: "sync graph",
            capabilities: [{ id: "c1", name: "read", description: "read", tags: [] }],
            metadata: {
              a2a: {
                source: "adk",
                streaming: true,
                version: "2.1.0",
                lastFetchedAt: "2026-07-01T00:00:00.000Z",
                latestTaskState: "working",
              },
            },
          },
        ]}
        onNodeClick={onNodeClick}
      />,
    );

    expect(screen.getByText("Gm")).toBeInTheDocument();
    expect(screen.getByText(/A2A · ADK · streaming/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Gemini Hermes Batch25"));
    expect(onNodeClick).toHaveBeenCalledWith(
      "agent-adk-batch25",
      "Gemini Hermes Batch25",
      "Gm",
      expect.objectContaining({
        Protocol: "A2A",
        Source: "ADK",
        Version: "2.1.0",
        "Current task": "sync graph",
        Capabilities: 1,
      }),
    );
  });

  it("collapses dev-tools group and routes tool-gateway stats", () => {
    const onNodeClick = vi.fn();
    render(
      <ReactFlowCanvas
        services={[]}
        agentCount={0}
        activeCount={0}
        memoryCount={0}
        knowledgeCount={0}
        skillCount={0}
        toolCapabilityCount={9}
        toolWorkspaceCount={3}
        nodeActivity={{ "tool-gateway": 2, librarian: 90 }}
        registeredAgents={[]}
        localActiveCount={2}
        localTotalCount={5}
        onNodeClick={onNodeClick}
      />,
    );

    expect(screen.getByText(/Mini view/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Tool Gateway"));
    expect(onNodeClick).toHaveBeenCalledWith(
      "tool-gateway",
      "Tool Gateway",
      expect.any(String),
      expect.objectContaining({ Capabilities: 9, Workspaces: 3 }),
    );

    fireEvent.click(screen.getByRole("button", { name: "toggle-group-devtools" }));
    const hiddenDevTools = captured.lastNodes.filter((n) => n.parentId === "group-devtools" && n.hidden);
    expect(hiddenDevTools.length).toBeGreaterThan(0);
    expect(screen.getByText("▶")).toBeInTheDocument();
  });

  it("derives idle node status from recent activity and non-string edge strokes", () => {
    render(
      <ReactFlowCanvas
        services={[]}
        agentCount={0}
        activeCount={0}
        memoryCount={0}
        knowledgeCount={0}
        skillCount={0}
        nodeActivity={{ request: 10 }}
        registeredAgents={[]}
        onNodeClick={vi.fn()}
      />,
    );

    const requestNode = captured.lastNodes.find((n) => n.id === "request");
    expect(requestNode?.data.status).toBe("idle");
    expect(captured.lastEdges.some((edge) => edge.style?.stroke !== undefined)).toBe(true);
  });
});
