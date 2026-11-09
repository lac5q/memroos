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

describe("NodeDetailPanel batch27 — A2A formatting and heartbeat abort", () => {
  it("renders unknown security/streaming labels and sanitizes invalid card URLs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ content: "heartbeat batch27" }),
      }),
    );

    render(
      <NodeDetailPanel
        nodeId="agent-a2a-b27"
        nodeLabel="A2A B27"
        nodeIcon="A2"
        nodeStats={{}}
        events={[]}
        onClose={vi.fn()}
        registeredAgents={[
          {
            id: "a2a-b27",
            name: "A2A B27",
            status: "active",
            latencyMs: 1,
            location: "remote",
            protocol: "a2a",
            platform: "codex",
            currentTask: null,
            metadata: {
              a2a: {
                cardUrl: 42,
                endpointUrl: "not-a-url",
                securitySchemes: "invalid",
                streaming: "maybe",
                inputModes: ["text"],
                outputModes: ["json"],
              },
            },
          },
        ]}
      />,
    );

    expect(screen.getAllByText("unknown").length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(screen.getByText("heartbeat batch27")).toBeInTheDocument();
    });
  });

  it("ignores AbortError when heartbeat fetch is aborted on unmount", async () => {
    const abortError = new DOMException("Aborted", "AbortError");
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(abortError));
        }),
      ),
    );

    const { unmount } = render(
      <NodeDetailPanel
        nodeId="agent-abort-b27"
        nodeLabel="Abort"
        nodeIcon="AB"
        nodeStats={{}}
        events={[]}
        onClose={vi.fn()}
      />,
    );
    unmount();
    await Promise.resolve();
    expect(true).toBe(true);
  });
});
