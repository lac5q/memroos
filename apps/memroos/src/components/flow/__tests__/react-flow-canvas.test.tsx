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
  }: {
    children?: React.ReactNode;
    onNodeClick?: (event: React.MouseEvent, node: { id: string; type?: string; data: Record<string, unknown> }) => void;
    nodes?: Array<{ id: string; type?: string; data: Record<string, unknown> }>;
  }) => {
    captured.lastNodes = nodes ?? [];
    return (
      <div data-testid="react-flow">
        {nodes?.map((node) => (
          <button
            key={node.id}
            type="button"
            data-node-id={node.id}
            onClick={(event) => onNodeClick?.(event, node)}
          >
            {String(node.data.label ?? node.id)}
          </button>
        ))}
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

const registeredAgents = [
  {
    id: "codex-1",
    name: "Codex Cloud",
    status: "active",
    latencyMs: 12,
    location: "local",
    protocol: "a2a",
    platform: "codex",
    metadata: { a2a: { source: "adk", streaming: true, version: "2.0", lastFetchedAt: "2026-07-01" } },
    capabilities: [{ id: "run", name: "Run", description: "", tags: [] }],
    currentTask: "lint",
  },
  {
    id: "claude-1",
    name: "Claude Code",
    status: "idle",
    latencyMs: null,
    location: "remote",
    protocol: "rest",
    platform: "claude",
  },
];

describe("ReactFlowCanvas", () => {
  it("mounts React Flow with agent stats and mini overview", () => {
    const onNodeClick = vi.fn();
    render(
      <ReactFlowCanvas
        services={[{ service: "Agents", status: "up" }]}
        agentCount={2}
        activeCount={1}
        memoryCount={5}
        knowledgeCount={10}
        skillCount={3}
        coverageGapsCount={1}
        toolCapabilityCount={4}
        toolWorkspaceCount={2}
        topFailureAgent="codex-1"
        nodeActivity={{ request: 1, notebooks: 10 }}
        registeredAgents={registeredAgents}
        localActiveCount={2}
        localTotalCount={5}
        onNodeClick={onNodeClick}
      />,
    );

    expect(screen.getByTestId("react-flow")).toBeInTheDocument();
    expect(screen.getByText("Live topology")).toBeInTheDocument();
    expect(screen.getByText(/Mini view/)).toBeInTheDocument();
    expect(screen.getByText("Codex Cloud")).toBeInTheDocument();
  });

  it("forwards node clicks with agent stats and toggles group collapse", () => {
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
        registeredAgents={registeredAgents}
        onNodeClick={onNodeClick}
      />,
    );

    fireEvent.click(screen.getByText("Codex Cloud"));
    expect(onNodeClick).toHaveBeenCalledWith(
      "agent-codex-1",
      "Codex Cloud",
      expect.any(String),
      expect.objectContaining({ Protocol: "A2A", Source: "ADK" }),
    );

    const groupNode = (captured.lastNodes as Array<{ id: string; data: { onToggleCollapse?: () => void } }>).find(
      (node) => node.id === "group-agents",
    );
    expect(groupNode?.data.onToggleCollapse).toBeTypeOf("function");
    groupNode?.data.onToggleCollapse?.();
  });

  it("renders topology without registered agents", () => {
    render(
      <ReactFlowCanvas
        services={[{ service: "QMD", status: "down" }]}
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
    expect(screen.getByText("Live topology")).toBeInTheDocument();
    expect(screen.getByText("0 Active")).toBeInTheDocument();
  });
});
