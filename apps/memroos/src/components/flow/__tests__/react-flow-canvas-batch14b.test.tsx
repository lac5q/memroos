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
    edges?: Array<{ id: string; source: string; target: string; style?: { stroke?: string } }>;
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

const baseProps = {
  services: [] as Array<{ service: string; status: "up" | "down" }>,
  agentCount: 2,
  activeCount: 1,
  memoryCount: 40,
  knowledgeCount: 120,
  skillCount: 8,
  nodeActivity: {} as Record<string, number>,
  registeredAgents: [] as Array<{
    id: string;
    name: string;
    status: string;
    latencyMs: number | null;
    location: string;
    protocol?: string;
    platform?: string;
    metadata?: Record<string, unknown>;
    capabilities?: Array<{ id: string; name: string; description: string; tags: string[] }>;
    currentTask?: string | null;
  }>,
  onNodeClick: vi.fn(),
};

describe("ReactFlowCanvas batch14b long-tail", () => {
  it("returns mem0 and QMD stats when memory nodes are clicked", () => {
    const onNodeClick = vi.fn();
    render(
      <ReactFlowCanvas
        {...baseProps}
        onNodeClick={onNodeClick}
      />,
    );

    fireEvent.click(screen.getByText("mem0"));
    expect(onNodeClick).toHaveBeenCalledWith(
      "notebooks",
      "mem0",
      expect.any(String),
      expect.objectContaining({ Entries: 40 }),
    );

    fireEvent.click(screen.getByText("QMD"));
    expect(onNodeClick).toHaveBeenCalledWith(
      "librarian",
      "QMD",
      expect.any(String),
      expect.objectContaining({ Docs: 120, Collections: 15 }),
    );
  });

  it("maps Paperclip down service to manager stats and gateway registration counts", () => {
    const onNodeClick = vi.fn();
    render(
      <ReactFlowCanvas
        {...baseProps}
        services={[{ service: "Paperclip", status: "down" }]}
        onNodeClick={onNodeClick}
      />,
    );

    fireEvent.click(screen.getByText("Paperclip"));
    expect(onNodeClick).toHaveBeenCalledWith(
      "manager",
      "Paperclip",
      expect.any(String),
      expect.objectContaining({ Platform: "Paperclip", Port: "3100" }),
    );

    fireEvent.click(screen.getByText("Gateways"));
    expect(onNodeClick).toHaveBeenCalledWith(
      "gateways",
      "Gateways",
      expect.any(String),
      expect.objectContaining({ Registered: 2, Active: 1 }),
    );
  });

  it("returns APO, GitNexus, and LLM Wiki stats for dev tool nodes", () => {
    const onNodeClick = vi.fn();
    render(
      <ReactFlowCanvas
        {...baseProps}
        onNodeClick={onNodeClick}
      />,
    );

    fireEvent.click(screen.getByText("Agent Lightning"));
    expect(onNodeClick).toHaveBeenCalledWith(
      "apo",
      "Agent Lightning",
      expect.any(String),
      expect.objectContaining({ Mode: "QA", Cycle: "hourly" }),
    );

    fireEvent.click(screen.getByText("GitNexus"));
    expect(onNodeClick).toHaveBeenCalledWith(
      "gitnexus",
      "GitNexus",
      expect.any(String),
      expect.objectContaining({ Repos: 8 }),
    );

    fireEvent.click(screen.getByText("LLM Wiki"));
    expect(onNodeClick).toHaveBeenCalledWith(
      "llmwiki",
      "LLM Wiki",
      expect.any(String),
      expect.objectContaining({ Topics: 6, Status: "active" }),
    );
  });

  it("uses agentStats for registered agent clicks including ADK metadata", () => {
    const onNodeClick = vi.fn();
    render(
      <ReactFlowCanvas
        {...baseProps}
        registeredAgents={[
          {
            id: "adk-hermes",
            name: "Hermes ADK",
            status: "active",
            latencyMs: 12,
            location: "cloudflare",
            protocol: "a2a",
            platform: "hermes",
            metadata: {
              a2a: {
                source: "adk",
                version: "2.1",
                lastFetchedAt: "2026-05-01T00:00:00.000Z",
                latestTaskState: "working",
                streaming: true,
              },
            },
            capabilities: [{ id: "cap", name: "Cap", description: "d", tags: ["t"] }],
            currentTask: "batch14b topology",
          },
        ]}
        onNodeClick={onNodeClick}
      />,
    );

    fireEvent.click(screen.getByText("Hermes ADK"));
    expect(onNodeClick).toHaveBeenCalledWith(
      "agent-adk-hermes",
      "Hermes ADK",
      "He",
      expect.objectContaining({
        Protocol: "A2A",
        Source: "ADK",
        Version: "2.1",
        "Current task": "batch14b topology",
        Capabilities: 1,
      }),
    );
  });

  it("marks request node idle when activity is between 5 and 60 minutes ago", () => {
    render(
      <ReactFlowCanvas
        {...baseProps}
        nodeActivity={{ request: 30 }}
        onNodeClick={vi.fn()}
      />,
    );
    const requestNode = (captured.lastNodes as Array<{ id: string; data: { status?: string } }>).find(
      (n) => n.id === "request",
    );
    expect(requestNode?.data.status).toBe("idle");
  });

  it("toggles Dev Tools collapse and restores child visibility on second toggle", () => {
    render(
      <ReactFlowCanvas
        {...baseProps}
        onNodeClick={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dev Tools" }));
    let hiddenCookbooks = (captured.lastNodes as Array<{ id: string; hidden?: boolean }>).find(
      (n) => n.id === "cookbooks",
    )?.hidden;
    expect(hiddenCookbooks).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Dev Tools" }));
    hiddenCookbooks = (captured.lastNodes as Array<{ id: string; hidden?: boolean }>).find(
      (n) => n.id === "cookbooks",
    )?.hidden;
    expect(hiddenCookbooks).toBeFalsy();
  });

  it("reports local agent activation stats when local-agents node is clicked", () => {
    const onNodeClick = vi.fn();
    render(
      <ReactFlowCanvas
        {...baseProps}
        localActiveCount={3}
        localTotalCount={5}
        onNodeClick={onNodeClick}
      />,
    );

    fireEvent.click(screen.getByText("3 Active"));
    expect(onNodeClick).toHaveBeenCalledWith(
      "local-agents",
      "3 Active",
      expect.any(String),
      expect.any(Object),
    );
  });

  it("renders mini overview edges for visible topology", () => {
    const { container } = render(
      <ReactFlowCanvas
        {...baseProps}
        registeredAgents={[
          {
            id: "gem-bot",
            name: "Gemini Bot",
            status: "idle",
            latencyMs: 1,
            location: "local",
            platform: "gemini",
          },
        ]}
        onNodeClick={vi.fn()}
      />,
    );

    expect(screen.getByText(/Mini view/i)).toBeInTheDocument();
    expect(container.querySelector("svg line")).toBeTruthy();
  });

  it("uses default edge stroke when style stroke is missing", () => {
    render(
      <ReactFlowCanvas
        {...baseProps}
        onNodeClick={vi.fn()}
      />,
    );
    const edges = captured.lastEdges as Array<{ style?: { stroke?: string } }>;
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.some((edge) => edge.style?.stroke)).toBe(true);
  });

  it("maps gemini platform agents to Gm icon", () => {
    render(
      <ReactFlowCanvas
        {...baseProps}
        registeredAgents={[
          {
            id: "gem-1",
            name: "Gemini Worker",
            status: "active",
            latencyMs: 2,
            location: "local",
            platform: "gemini",
          },
        ]}
        onNodeClick={vi.fn()}
      />,
    );
    const node = (captured.lastNodes as Array<{ id: string; data: { icon?: string } }>).find(
      (n) => n.id === "agent-gem-1",
    );
    expect(node?.data.icon).toBe("Gm");
  });
});
