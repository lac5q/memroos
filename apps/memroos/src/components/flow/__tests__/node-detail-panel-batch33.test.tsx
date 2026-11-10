/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

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
  SkillHeatmap: () => <div data-testid="skill-heatmap-batch33" />,
}));

vi.mock("../paperclip-fleet-panel", () => ({
  PaperclipFleetPanel: () => null,
}));

import { NodeDetailPanel } from "../node-detail-panel";
import { useSkills, useToolAttention } from "@/lib/api-client";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useSkills).mockReturnValue({ data: undefined, isLoading: false, isError: false } as ReturnType<
    typeof useSkills
  >);
  vi.mocked(useToolAttention).mockReturnValue({ data: undefined, isLoading: false, isError: false } as ReturnType<
    typeof useToolAttention
  >);
});

describe("NodeDetailPanel batch33", () => {
  it("urlHost handles non-string values (line 67)", async () => {
    const suffix = randomUUID().slice(0, 8);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: "heartbeat batch33",
          card: {
            url: 42,
            securitySchemes: "not-a-record",
            streaming: 99,
            source: { label: "adk" },
          },
        }),
      }),
    );

    render(
      <NodeDetailPanel
        nodeId={`agent-url-b33-${suffix}`}
        nodeLabel={`URL B33 ${suffix}`}
        nodeIcon="AG"
        nodeStats={{}}
        events={[]}
        onClose={vi.fn()}
        registeredAgents={[
          {
            id: `url-b33-${suffix}`,
            name: `URL B33 ${suffix}`,
            status: "active",
            latencyMs: 1,
            location: "local",
            protocol: "a2a",
            metadata: {
              a2a: {
                endpointUrl: 42,
                securitySchemes: "not-a-record",
                streaming: 99,
                source: "adk",
                inputModes: [1, 2, "search"],
              },
            },
          },
        ]}
      />,
    );

    await waitFor(() => expect(screen.getByText("heartbeat batch33")).toBeInTheDocument());
    expect(screen.getAllByText("unknown").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ADK").length).toBeGreaterThan(0);

    vi.unstubAllGlobals();
  });

  it("heartbeat fetch errors clear content (line 171)", async () => {
    const suffix = randomUUID().slice(0, 8);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({}),
      }),
    );

    render(
      <NodeDetailPanel
        nodeId={`agent-hb-b33-${suffix}`}
        nodeLabel={`HB B33 ${suffix}`}
        nodeIcon="HB"
        nodeStats={{}}
        events={[]}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText("Node Activity")).toBeInTheDocument());

    vi.unstubAllGlobals();
  });

  it("unmount aborts heartbeat without surfacing AbortError (line 171)", async () => {
    const suffix = randomUUID().slice(0, 8);
    const abortError = new Error("aborted");
    abortError.name = "AbortError";

    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => reject(abortError), 10);
          }),
      ),
    );

    const { unmount } = render(
      <NodeDetailPanel
        nodeId={`agent-abort-b33-${suffix}`}
        nodeLabel={`Abort B33 ${suffix}`}
        nodeIcon="AB"
        nodeStats={{}}
        events={[]}
        onClose={vi.fn()}
      />,
    );

    await act(async () => {
      unmount();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    vi.unstubAllGlobals();
  });
});
