/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/components/dispatch/lineage-drawer", () => ({ LineageDrawer: () => null }));
vi.mock("@/lib/api-client", () => ({ useAgents: vi.fn(), useDelegations: vi.fn() }));

import { useAgents, useDelegations } from "@/lib/api-client";
import { AgentEngagementConsole } from "../agent-engagement-console";

const baseAgent = {
  name: "Batch26 Agent",
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useDelegations).mockReturnValue({ data: { delegations: [] }, isLoading: false } as ReturnType<typeof useDelegations>);
  URL.createObjectURL = vi.fn(() => "blob:engagement-batch26");
  URL.revokeObjectURL = vi.fn();
});

describe("AgentEngagementConsole batch26", () => {
  it("orders two common roster agents by COMMON_AGENT_IDS precedence", () => {
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [
          { ...baseAgent, id: "gwen", name: "Gwen Common", status: "idle" },
          { ...baseAgent, id: "alba", name: "Alba Common", status: "idle" },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    render(<AgentEngagementConsole />);
    const names = screen.getAllByText(/Alba Common|Gwen Common/).map((el) => el.textContent);
    expect(names.indexOf("Alba Common")).toBeLessThan(names.indexOf("Gwen Common"));
  });

  it("labels unknown platforms and tolerates circular metadata", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [
          { ...baseAgent, id: "exotic-batch26", name: "Exotic Batch26", platform: "custom-platform-x" as typeof baseAgent.platform },
          { ...baseAgent, id: "meta-batch26", name: "Meta Batch26", metadata: circular },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    render(<AgentEngagementConsole />);
    expect(screen.getAllByText(/custom-platform-x - Worker/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Meta Batch26").length).toBeGreaterThan(0);
  });

  it("surfaces chat HTTP failures when response text cannot be read", async () => {
    vi.mocked(useAgents).mockReturnValue({
      data: { agents: [{ ...baseAgent, id: "chat-batch26", name: "Chat Batch26" }] },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        if (String(input).includes("/api/chat")) {
          return {
            ok: false,
            status: 503,
            text: async () => {
              throw new Error("body unreadable batch26");
            },
          };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );

    render(<AgentEngagementConsole />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), { target: { value: "ping batch26" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(screen.getByText(/HTTP 503/i)).toBeInTheDocument());
  });

  it("clears speaking state when TTS playback errors on the audio element", async () => {
    class ErrorAudio {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      pause = vi.fn();
      play = vi.fn().mockImplementation(async () => {
        this.onerror?.();
      });
    }
    vi.stubGlobal("Audio", ErrorAudio);

    class MockRecognition {
      continuous = false;
      interimResults = false;
      lang = "en-US";
      onresult: ((event: { results: Array<Array<{ transcript: string }>> }) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        this.onresult?.({ results: [[{ transcript: "spoken batch26 prompt" }]] });
        this.onend?.();
      }
      stop() {
        this.onend?.();
      }
    }
    vi.stubGlobal("SpeechRecognition", MockRecognition);
    vi.stubGlobal("webkitSpeechRecognition", MockRecognition);

    vi.mocked(useAgents).mockReturnValue({
      data: { agents: [{ ...baseAgent, id: "tts-batch26", name: "TTS Batch26", platform: "codex" }] },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/api/chat")) {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"text":"batch26 voice reply"}\n\n'));
              controller.close();
            },
          });
          return { ok: true, body: stream };
        }
        if (url.includes("/api/tts")) {
          return { ok: true, blob: async () => new Blob(["audio"]) };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /Direct Chat/i }));
    fireEvent.click(screen.getByRole("button", { name: "Speak to agent" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/tts", expect.objectContaining({ method: "POST" })));
  });

  it("merges per-agent diagnostic checks from engagement test API", async () => {
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [
          { ...baseAgent, id: "diag-a-batch26", name: "Diag A" },
          { ...baseAgent, id: "diag-b-batch26", name: "Diag B" },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        if (String(input).includes("/api/engagement/test")) {
          return {
            ok: true,
            json: async () => ({
              results: [
                {
                  agentId: "diag-a-batch26",
                  name: "Diag A",
                  status: "active",
                  chat: { status: "ready", detail: "batch26 chat ok", runner: "codex", model: "gpt" },
                  dispatch: { status: "ready", detail: "local dispatch", adapter: "local" },
                  voice: { status: "ready", detail: "voice ready batch26" },
                },
                {
                  agentId: "diag-b-batch26",
                  name: "Diag B",
                  status: "active",
                  chat: { status: "ready", detail: "batch26 chat ok b", runner: "codex", model: "gpt" },
                  dispatch: { status: "ready", detail: "local dispatch", adapter: "local" },
                  voice: { status: "ready", detail: "voice ready batch26" },
                },
              ],
            }),
          };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /Test primary agents/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/engagement/test", expect.objectContaining({ method: "POST" }));
      expect(screen.getAllByText(/codex \/ gpt/i).length).toBeGreaterThan(0);
    });
  });

  it("shows empty room guidance when all participants are toggled off", () => {
    vi.mocked(useAgents).mockReturnValue({
      data: { agents: [{ ...baseAgent, id: "solo-batch26", name: "Solo Batch26" }] },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /Group Room/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Room$/i })[0]!);
    expect(screen.getByText(/Select at least one Room participant/i)).toBeInTheDocument();
  });

  it("uses default conference prompt when the room message box is empty", async () => {
    vi.mocked(useAgents).mockReturnValue({
      data: { agents: [{ ...baseAgent, id: "room-batch26", name: "Room Batch26" }] },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        if (String(input).includes("/api/chat")) {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"text":"batch26 conference ok"}\n\n'));
              controller.close();
            },
          });
          return { ok: true, body: stream };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /Group Room/i }));
    fireEvent.click(screen.getByRole("button", { name: /Start conference round/i }));

    await waitFor(() => {
      const chatCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes("/api/chat"));
      expect(chatCall).toBeTruthy();
      const body = JSON.parse(String((chatCall![1] as RequestInit).body));
      expect(body.message).toMatch(/conference|standup|room/i);
    });
  });
});
