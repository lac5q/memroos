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

const baseAgent = {
  id: "codex-cli-agent",
  name: "Codex Agent",
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
  createdAt: "2026-05-11T00:00:00Z",
  updatedAt: "2026-05-11T00:00:00Z",
  deregisteredAt: null,
};

function mockAgents(agents: typeof baseAgent[]) {
  vi.mocked(useAgents).mockReturnValue({
    data: { agents },
    isLoading: false,
  } as ReturnType<typeof useAgents>);
  vi.mocked(useDelegations).mockReturnValue({
    data: { delegations: [] },
    isLoading: false,
  } as ReturnType<typeof useDelegations>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  URL.createObjectURL = vi.fn(() => "blob:batch21-mock");
  URL.revokeObjectURL = vi.fn();
});

describe("AgentEngagementConsole batch21", () => {
  it("revokes TTS object URLs on audio end after spoken chat", async () => {
    mockAgents([baseAgent]);
    class MockAudio {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      pause = vi.fn();
      async play() {
        this.onended?.();
      }
    }
    vi.stubGlobal("Audio", MockAudio);
    class MockRecognition {
      continuous = false;
      interimResults = false;
      lang = "en-US";
      onresult: ((event: { results: Array<{ 0: { transcript: string } }> }) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        this.onresult?.({ results: [{ 0: { transcript: "Say hello" } }] });
        this.onend?.();
      }
      stop() {
        this.onend?.();
      }
    }
    vi.stubGlobal("SpeechRecognition", MockRecognition);
    vi.stubGlobal("webkitSpeechRecognition", MockRecognition);

    const encoder = new TextEncoder();
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/chat")) {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"text":"Spoken hello"}\n\n'));
            controller.close();
          },
        });
        return new Response(stream, { status: 200 });
      }
      if (url.includes("/api/tts")) {
        return {
          ok: true,
          blob: async () => new Blob(["audio-bytes"], { type: "audio/mpeg" }),
        } as Response;
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /Direct Chat/i }));
    fireEvent.click(screen.getByRole("button", { name: "Speak to agent" }));

    await waitFor(() => {
      expect(screen.getByText(/Spoken hello/i)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:batch21-mock");
    });
  });

  it("includes prior non-system history when sending a follow-up chat message", async () => {
    mockAgents([baseAgent]);
    const encoder = new TextEncoder();
    const chatBodies: Array<{ history?: Array<{ role: string; content: string }> }> = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/chat")) {
        chatBodies.push(JSON.parse(String(init?.body)));
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(`data: {"text":"Reply ${chatBodies.length}"}\n\n`),
            );
            controller.close();
          },
        });
        return new Response(stream, { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /Direct Chat/i }));
    fireEvent.change(screen.getByLabelText("Direct message"), {
      target: { value: "First turn" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => {
      expect(screen.getByText(/Reply 1/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Direct message"), {
      target: { value: "Second turn" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => {
      expect(screen.getByText(/Reply 2/i)).toBeInTheDocument();
    });

    for (let turn = 3; turn <= 12; turn += 1) {
      fireEvent.change(screen.getByLabelText("Direct message"), {
        target: { value: `Turn ${turn}` },
      });
      fireEvent.click(screen.getByRole("button", { name: "Send message" }));
      await waitFor(() => {
        expect(chatBodies.length).toBeGreaterThanOrEqual(turn);
      });
    }

    const last = chatBodies.at(-1);
    expect(last?.history?.length).toBeLessThanOrEqual(10);
    expect(last?.history?.every((entry) => entry.role !== "system")).toBe(true);
  });

  it("runs per-agent Test with a single agent id", async () => {
    mockAgents([baseAgent]);
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/engagement/test")) {
        const body = JSON.parse(String(init?.body)) as { agentIds?: string[] };
        expect(body.agentIds).toEqual([baseAgent.id]);
        return new Response(
          JSON.stringify({
            results: [
              {
                agentId: baseAgent.id,
                name: baseAgent.name,
                status: "active",
                chat: { status: "ready", runner: "local", model: "test", detail: "ok" },
                dispatch: { status: "ready", adapter: "local", detail: "ok" },
                voice: { status: "ready", detail: "ok" },
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Test$/i })[0]!);

    await waitFor(() => {
      expect(screen.getByText(/local \/ test/i)).toBeInTheDocument();
    });
  });
});
