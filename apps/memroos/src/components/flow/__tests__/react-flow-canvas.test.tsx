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
                onKeyDown={() => {}}
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

  it("renders qwen-specific icons and maps non-active agents to dormant nodes", () => {
    render(
      <ReactFlowCanvas
        services={[{ service: "Agents", status: "degraded" }]}
        agentCount={1}
        activeCount={0}
        memoryCount={0}
        knowledgeCount={0}
        skillCount={0}
        nodeActivity={{}}
        registeredAgents={[
          {
            id: "qwen-1",
            name: "Qwen Worker",
            status: "error",
            latencyMs: 400,
            location: "remote",
            protocol: "rest",
            platform: "qwen",
            currentTask: "repair",
          },
        ]}
        onNodeClick={vi.fn()}
      />,
    );
    expect(screen.getByText("Qwen Worker")).toBeInTheDocument();
    const agentNode = (
      captured.lastNodes as Array<{ id: string; data: { icon?: string; status?: string } }>
    ).find((node) => node.id === "agent-qwen-1");
    expect(agentNode?.data.icon).toBe("Qw");
    expect(agentNode?.data.status).toBe("dormant");
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

  it("maps platform-specific agent icons and generic initials", () => {
    render(
      <ReactFlowCanvas
        services={[]}
        agentCount={4}
        activeCount={1}
        memoryCount={0}
        knowledgeCount={0}
        skillCount={0}
        nodeActivity={{}}
        registeredAgents={[
          { id: "gem-1", name: "Gemini Worker", status: "active", latencyMs: null, location: "local", platform: "gemini" },
          { id: "herm-1", name: "Hermes Bot", status: "idle", latencyMs: null, location: "local", platform: "hermes" },
          { id: "oc-1", name: "OpenClaw Runner", status: "idle", latencyMs: null, location: "local", platform: "openclaw" },
          {
            id: "adk-1",
            name: "ADK Bridge",
            status: "idle",
            latencyMs: null,
            location: "local",
            protocol: "a2a",
            metadata: { a2a: { source: "adk" } },
          },
          { id: "custom-1", name: "Beta Tester", status: "idle", latencyMs: null, location: "local" },
        ]}
        onNodeClick={vi.fn()}
      />,
    );

    const nodes = captured.lastNodes as Array<{ id: string; data: { icon?: string } }>;
    expect(nodes.find((n) => n.id === "agent-gem-1")?.data.icon).toBe("Gm");
    expect(nodes.find((n) => n.id === "agent-herm-1")?.data.icon).toBe("He");
    expect(nodes.find((n) => n.id === "agent-oc-1")?.data.icon).toBe("Oc");
    expect(nodes.find((n) => n.id === "agent-adk-1")?.data.icon).toBe("ADK");
    expect(nodes.find((n) => n.id === "agent-custom-1")?.data.icon).toBe("BT");
  });

  it("forwards infrastructure node stats and supports collapse expand", () => {
    const onNodeClick = vi.fn();
    render(
      <ReactFlowCanvas
        services={[
          { service: "Agents", status: "up" },
          { service: "mem0", status: "up" },
          { service: "QMD", status: "up" },
        ]}
        agentCount={3}
        activeCount={2}
        memoryCount={12}
        knowledgeCount={99}
        skillCount={7}
        coverageGapsCount={2}
        toolCapabilityCount={5}
        toolWorkspaceCount={3}
        topFailureAgent="codex-cli-agent"
        nodeActivity={{ request: 2, cookbooks: 30 }}
        registeredAgents={registeredAgents}
        onNodeClick={onNodeClick}
      />,
    );

    fireEvent.click(screen.getByText("Skills"));
    expect(onNodeClick).toHaveBeenCalledWith(
      "cookbooks",
      "Skills",
      expect.any(String),
      expect.objectContaining({ Skills: 7, Gaps: 2, "Top Failure": "codex-cli-agent" }),
    );

    fireEvent.click(screen.getByText("QMD"));
    expect(onNodeClick).toHaveBeenCalledWith(
      "librarian",
      "QMD",
      expect.any(String),
      expect.objectContaining({ Docs: 99, Collections: 15 }),
    );

    const groupNode = (captured.lastNodes as Array<{ id: string; data: { onToggleCollapse?: () => void; collapsed?: boolean } }>).find(
      (node) => node.id === "group-devtools",
    );
    groupNode?.data.onToggleCollapse?.();
    groupNode?.data.onToggleCollapse?.();
    expect(screen.getByText(/Mini view/)).toBeInTheDocument();
  });

  it("renders custom flow nodes with highlighted active styling", () => {
    render(
      <ReactFlowCanvas
        services={[]}
        agentCount={1}
        activeCount={1}
        memoryCount={0}
        knowledgeCount={0}
        skillCount={0}
        nodeActivity={{ gateways: 10 }}
        highlightedNode="gateways"
        registeredAgents={registeredAgents.slice(0, 1)}
        onNodeClick={vi.fn()}
      />,
    );

    expect(screen.getByText("Gateways")).toBeInTheDocument();
    expect(screen.getByText("Server Agents")).toBeInTheDocument();
  });
});
