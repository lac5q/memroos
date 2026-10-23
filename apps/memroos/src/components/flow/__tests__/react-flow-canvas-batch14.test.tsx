/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  onNodeClick: vi.fn(),
  lastNodes: [] as unknown[],
  lastEdges: [] as unknown[],
}));

vi.mock("@xyflow/react", () => ({
  ReactFlow: ({
    children,
    onNodeClick,
    nodes,
    edges,
    nodeTypes,
  }: {
    children?: React.ReactNode;
    onNodeClick?: (event: React.MouseEvent, node: { id: string; type?: string; data: Record<string, unknown> }) => void;
    nodes?: Array<{ id: string; type?: string; data: Record<string, unknown>; hidden?: boolean }>;
    edges?: unknown[];
    nodeTypes?: Record<string, React.ComponentType<{ data: Record<string, unknown> }>>;
  }) => {
    captured.lastNodes = nodes ?? [];
    captured.lastEdges = edges ?? [];
    return (
      <div data-testid="react-flow">
        {nodes?.map((node) => {
          if (node.type === "groupBoxNode") {
            return (
              <button
                key={node.id}
                type="button"
                data-group-id={node.id}
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

describe("ReactFlowCanvas batch14 coverage", () => {
  it("maps platform-specific agent icons and dormant status", () => {
    render(
      <ReactFlowCanvas
        services={[{ service: "Agents", status: "up" }]}
        agentCount={4}
        activeCount={2}
        memoryCount={1}
        knowledgeCount={2}
        skillCount={3}
        nodeActivity={{ gateways: 2 }}
        registeredAgents={[
          {
            id: "codex-1",
            name: "Codex Runner",
            status: "idle",
            latencyMs: 10,
            location: "local",
            platform: "codex",
          },
          {
            id: "claude-1",
            name: "Claude Worker",
            status: "idle",
            latencyMs: 10,
            location: "remote",
            platform: "claude",
          },
        ]}
        onNodeClick={vi.fn()}
      />,
    );

    const nodes = captured.lastNodes as Array<{ id: string; data: { icon?: string; status?: string } }>;
    expect(nodes.find((n) => n.id === "agent-codex-1")?.data.icon).toBe("Cx");
    expect(nodes.find((n) => n.id === "agent-claude-1")?.data.status).toBe("dormant");
    expect(nodes.find((n) => n.id === "gateways")?.data.status).toBe("active");
  });

  it("returns cookbooks stats with top failure agent and tool gateway counts", () => {
    const onNodeClick = vi.fn();
    render(
      <ReactFlowCanvas
        services={[]}
        agentCount={0}
        activeCount={0}
        memoryCount={0}
        knowledgeCount={0}
        skillCount={5}
        coverageGapsCount={2}
        topFailureAgent="ops-bot"
        toolCapabilityCount={12}
        toolWorkspaceCount={3}
        nodeActivity={{}}
        registeredAgents={[]}
        localActiveCount={2}
        localTotalCount={4}
        onNodeClick={onNodeClick}
      />,
    );

    fireEvent.click(screen.getByText("Skills"));
    expect(onNodeClick).toHaveBeenCalledWith(
      "cookbooks",
      "Skills",
      expect.any(String),
      expect.objectContaining({ Gaps: 2, "Top Failure": "ops-bot" }),
    );

    fireEvent.click(screen.getByText("Tool Gateway"));
    expect(onNodeClick).toHaveBeenCalledWith(
      "tool-gateway",
      "Tool Gateway",
      expect.any(String),
      expect.objectContaining({ Capabilities: 12, Workspaces: 3 }),
    );
  });

  it("collapses agent group and renders mini overview", () => {
    render(
      <ReactFlowCanvas
        services={[]}
        agentCount={1}
        activeCount={1}
        memoryCount={0}
        knowledgeCount={0}
        skillCount={0}
        nodeActivity={{ request: 30 }}
        registeredAgents={[
          {
            id: "qwen-1",
            name: "Qwen Hermes Gemini",
            status: "active",
            latencyMs: 1,
            location: "local",
            platform: "qwen",
          },
        ]}
        highlightedNode="request"
        onNodeClick={vi.fn()}
      />,
    );

    expect(screen.getByText(/Mini view/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Server Agents" }));
    const hidden = (captured.lastNodes as Array<{ id: string; hidden?: boolean }>).some((n) => n.hidden);
    expect(hidden).toBe(true);
  });

  it("ignores group box clicks in handleNodeClick", () => {
    const onNodeClick = vi.fn();
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
        onNodeClick={onNodeClick}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dev Tools" }));
    expect(onNodeClick).not.toHaveBeenCalled();
  });
});
