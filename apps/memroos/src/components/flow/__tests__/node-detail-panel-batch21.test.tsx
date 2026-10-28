/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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
  SkillHeatmap: () => null,
}));

vi.mock("../paperclip-fleet-panel", () => ({
  PaperclipFleetPanel: () => null,
}));

import { NodeDetailPanel } from "../node-detail-panel";
import { useSkills, useToolAttention } from "@/lib/api-client";

const DEFAULT_PROPS = {
  nodeLabel: "Remote",
  nodeIcon: "🛰",
  nodeStats: {},
  events: [],
  onClose: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    }),
  );
  vi.mocked(useSkills).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
  } as ReturnType<typeof useSkills>);
  vi.mocked(useToolAttention).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
  } as ReturnType<typeof useToolAttention>);
});

describe("NodeDetailPanel batch21", () => {
  it("sanitizes invalid A2A endpoint URLs and shows non-streaming label", () => {
    render(
      <NodeDetailPanel
        {...DEFAULT_PROPS}
        nodeId="agent-remote-2"
        registeredAgents={[
          {
            id: "remote-2",
            name: "Remote Two",
            status: "active",
            latencyMs: 12,
            location: "remote",
            protocol: "a2a",
            platform: "codex",
            currentTask: null,
            metadata: {
              a2a: {
                endpointUrl: "not a valid url //user:secret@host/path",
                version: "0.1",
                securitySchemes: {},
                streaming: false,
                source: "registry",
                inputModes: ["text"],
                outputModes: ["text"],
              },
            },
          },
        ]}
      />,
    );

    expect(screen.getByText("A2A connection")).toBeInTheDocument();
    expect(screen.getByText("not a valid url //host/path")).toBeInTheDocument();
    expect(screen.getByText("not declared")).toBeInTheDocument();
  });
});
