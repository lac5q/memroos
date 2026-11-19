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
  SkillHeatmap: () => null,
}));

vi.mock("../paperclip-fleet-panel", () => ({
  PaperclipFleetPanel: () => null,
}));

import { NodeDetailPanel } from "../node-detail-panel";
import { useSkills, useToolAttention } from "@/lib/api-client";

beforeEach(() => {
  vi.clearAllMocks();
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

describe("NodeDetailPanel batch22", () => {
  it("formats security schemes and boolean streaming labels for A2A agents", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ content: "heartbeat ok" }),
      }),
    );

    render(
      <NodeDetailPanel
        nodeId="agent-a2a-1"
        nodeLabel="A2A One"
        nodeIcon="A2"
        nodeStats={{}}
        events={[]}
        onClose={vi.fn()}
        registeredAgents={[
          {
            id: "a2a-1",
            name: "A2A One",
            status: "active",
            latencyMs: 1,
            location: "remote",
            protocol: "a2a",
            platform: "codex",
            currentTask: null,
            metadata: {
              a2a: {
                cardUrl: "https://user:pass@example.com/card",
                endpointUrl: "https://user:pass@example.com/run",
                securitySchemes: {
                  bearer: { type: "http", scheme: "bearer" },
                  empty: { type: "apiKey" },
                },
                streaming: true,
                source: "adk",
                inputModes: ["text", 42],
                outputModes: ["json"],
              },
            },
          },
        ]}
      />,
    );

    expect(screen.getByText("supported")).toBeInTheDocument();
    expect(screen.getAllByText("ADK").length).toBeGreaterThan(0);
    expect(screen.getByText(/http bearer/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("heartbeat ok")).toBeInTheDocument();
    });
  });

  it("skips heartbeat fetch when nodeId is cleared", () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: "ok" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(
      <NodeDetailPanel
        nodeId="agent-x"
        nodeLabel="X"
        nodeIcon="X"
        nodeStats={{}}
        events={[]}
        onClose={vi.fn()}
      />,
    );

    const callsAfterMount = fetchMock.mock.calls.length;
    rerender(
      <NodeDetailPanel
        nodeId={null}
        nodeLabel="X"
        nodeIcon="X"
        nodeStats={{}}
        events={[]}
        onClose={vi.fn()}
      />,
    );

    expect(fetchMock.mock.calls.length).toBe(callsAfterMount);
  });
});
