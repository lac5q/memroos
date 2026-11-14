/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

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
      <div data-testid="react-flow-batch35b">
        {nodes?.map((node) => {
          if (node.hidden) return null;
          if (node.type === "groupBoxNode") {
            return (
              <div key={node.id}>
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

import { ReactFlowCanvas } from "../react-flow-canvas";

describe("ReactFlowCanvas batch35b", () => {
  it.skip("getStatus agentStatus branch (434) — getStatus is never invoked with a second argument in this module", () => {});

  it.skip("MiniOverview empty points guard (321) — group box nodes are never hidden so visibleNodes is never empty", () => {});

  it.skip("absoluteNodePosition missing parent break (300) — collapse always hides children before parent leaves the visible set", () => {});

  it("MiniOverview walks parent offsets when devtools children are expanded (301-303)", () => {
    const suffix = randomUUID().slice(0, 8);
    render(
      <ReactFlowCanvas
        services={[]}
        agentCount={1}
        activeCount={1}
        memoryCount={1}
        knowledgeCount={1}
        skillCount={3}
        nodeActivity={{}}
        registeredAgents={[
          {
            id: `parent-chain-b35b-${suffix}`,
            name: `Parent chain ${suffix}`,
            status: "active",
            latencyMs: 1,
            location: "local",
            platform: "claude",
          },
        ]}
        onNodeClick={vi.fn()}
      />,
    );
    expect(screen.getByText(/Mini view/i)).toBeInTheDocument();
    const devChild = captured.lastNodes.find((n) => n.id === "gitnexus");
    expect(devChild?.parentId).toBe("group-devtools");
    fireEvent.click(screen.getByRole("button", { name: "toggle-group-devtools" }));
    expect(captured.lastNodes.find((n) => n.id === "gitnexus")?.hidden).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "toggle-group-devtools" }));
    expect(captured.lastNodes.find((n) => n.id === "gitnexus")?.hidden).not.toBe(true);
  });

  it("registered agent non-active status maps to dormant on flow nodes (533)", () => {
    const suffix = randomUUID().slice(0, 8);
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
            id: `dormant-b35b-${suffix}`,
            name: `Dormant ${suffix}`,
            status: "offline",
            latencyMs: null,
            location: "remote",
            platform: "codex",
          },
        ]}
        onNodeClick={vi.fn()}
      />,
    );
    const agentNode = captured.lastNodes.find((n) => n.id === `agent-dormant-b35b-${suffix}`);
    expect(agentNode?.data.status).toBe("dormant");
  });
});
