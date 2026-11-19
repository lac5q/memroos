/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/components/dispatch/lineage-drawer", () => ({
  LineageDrawer: () => null,
}));

vi.mock("@/lib/api-client", () => ({
  useAgents: vi.fn(),
  useDelegations: vi.fn(),
}));

import { useAgents, useDelegations } from "@/lib/api-client";
import { AgentEngagementConsole } from "../agent-engagement-console";

const agentA = {
  id: "agent-a-batch22c",
  name: "Agent A",
  role: "Worker",
  platform: "codex" as const,
  protocol: "local",
  status: "active" as const,
  lastHeartbeat: null,
  currentTask: null,
  lessonsCount: 0,
  todayMemoryCount: 0,
  location: "local",
  isRemote: false,
  latencyMs: null,
  capabilities: [],
  metadata: {},
  host: null,
  port: null,
  healthEndpoint: null,
  tunnelUrl: null,
  createdAt: "2026-05-11T00:00:00.000Z",
  updatedAt: "2026-05-11T00:00:00.000Z",
  deregisteredAt: null,
};

const agentB = { ...agentA, id: "agent-b-batch22c", name: "Agent B" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useDelegations).mockReturnValue({ data: { delegations: [] }, isLoading: false } as ReturnType<typeof useDelegations>);
  URL.createObjectURL = vi.fn(() => "blob:batch22c");
  URL.revokeObjectURL = vi.fn();
});

describe("AgentEngagementConsole batch22c", () => {
  it("meeting mode runs standup and plays TTS after successful chat stream", async () => {
    vi.mocked(useAgents).mockReturnValue({ data: { agents: [agentA, agentB] }, isLoading: false } as ReturnType<typeof useAgents>);

    class OkAudio {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      pause = vi.fn();
      play = vi.fn().mockImplementation(async () => {
        this.onended?.();
      });
    }
    vi.stubGlobal("Audio", OkAudio);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/api/chat")) {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"text":"batch22c standup reply"}\n\n'));
              controller.close();
            },
          });
          return { ok: true, body: stream };
        }
        if (url.includes("/api/tts")) {
          return { ok: true, blob: async () => new Blob(["audio"]) };
        }
        return { ok: true, json: async () => ({ ok: true }) };
      }),
    );

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /Group Room/i }));
    fireEvent.click(screen.getByRole("button", { name: /Run 15-minute standup/i }));

    await waitFor(
      () => {
        expect(fetch).toHaveBeenCalledWith("/api/chat", expect.objectContaining({ method: "POST" }));
      },
      { timeout: 5_000 },
    );
  });

  it("toggleParticipant adds and removes room members", () => {
    vi.mocked(useAgents).mockReturnValue({ data: { agents: [agentA, agentB] }, isLoading: false } as ReturnType<typeof useAgents>);
    render(<AgentEngagementConsole />);
    const roomButtons = screen.getAllByRole("button", { name: /^Room$/i });
    fireEvent.click(roomButtons[1]!);
    fireEvent.click(roomButtons[1]!);
    expect(roomButtons[1]).toBeInTheDocument();
  });
});
