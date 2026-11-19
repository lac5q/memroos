/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/api-client", () => ({
  useSkills: vi.fn(),
  useToolAttention: vi.fn(),
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/skill-heatmap", () => ({
  SkillHeatmap: () => <div data-testid="skill-heatmap">heatmap</div>,
}));

vi.mock("../paperclip-fleet-panel", () => ({
  PaperclipFleetPanel: () => <div data-testid="paperclip-fleet">fleet</div>,
}));

import { NodeDetailPanel } from "../node-detail-panel";
import { useSkills, useToolAttention } from "@/lib/api-client";

const DEFAULT_PROPS = {
  nodeLabel: "Cookbooks",
  nodeIcon: "📚",
  nodeStats: { Skills: 3 },
  events: [],
  onClose: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: "heartbeat ok b19" }),
    }),
  );
  vi.mocked(useSkills).mockReturnValue({
    data: {
      totalSkills: 12,
      contributionHistory: [],
      coverageGaps: [{ skill: "gap-b19" }],
      failuresByAgent: { codex: 2 },
    },
    isLoading: false,
    isError: false,
  } as ReturnType<typeof useSkills>);
  vi.mocked(useToolAttention).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
  } as ReturnType<typeof useToolAttention>);
});

describe("NodeDetailPanel batch19", () => {
  it("uses live skills stats for cookbooks nodes", () => {
    render(<NodeDetailPanel {...DEFAULT_PROPS} nodeId="cookbooks" />);
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Failures")).toBeInTheDocument();
  });

  it("renders agent a2a detail rows when node id references a registered agent", () => {
    render(
      <NodeDetailPanel
        {...DEFAULT_PROPS}
        nodeId="agent-codex-cli-agent"
        nodeLabel="Codex"
        registeredAgents={[
          {
            id: "codex-cli-agent",
            name: "Codex",
            status: "active",
            latencyMs: 12,
            location: "local",
            protocol: "a2a",
            platform: "codex",
            metadata: {
              a2a: {
                source: "adk",
                streaming: true,
                securitySchemes: {
                  bearer: { type: "http", scheme: "bearer" },
                },
                endpointUrl: "http://localhost:8080/agent",
              },
            },
            capabilities: [],
          },
        ]}
      />,
    );
    expect(screen.getAllByText("ADK").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/supported/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/localhost:8080/i)).toBeInTheDocument();
  });

  it("shows heartbeat content when fetch succeeds", async () => {
    render(<NodeDetailPanel {...DEFAULT_PROPS} nodeId="codex" />);
    await waitFor(() => {
      expect(screen.getAllByText("Last State").length).toBeGreaterThan(0);
    });
  });

  it("clears heartbeat state when nodeId becomes null", async () => {
    const { rerender } = render(<NodeDetailPanel {...DEFAULT_PROPS} nodeId="codex" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    rerender(<NodeDetailPanel {...DEFAULT_PROPS} nodeId={null} />);
    expect(screen.queryByText("Cookbooks")).not.toBeInTheDocument();
  });
});
