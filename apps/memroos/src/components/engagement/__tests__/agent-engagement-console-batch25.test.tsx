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
  name: "Batch25 Agent",
  role: "Worker",
  platform: "codex" as const,
  protocol: "local",
  status: "idle" as const,
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
  URL.createObjectURL = vi.fn(() => "blob:engagement-batch25");
  URL.revokeObjectURL = vi.fn();
});

describe("AgentEngagementConsole batch25", () => {
  it("orders common agents ahead of directory agents and labels paperclip roster entries", () => {
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [
          { ...baseAgent, id: "zz-batch25", name: "ZZ Directory", status: "idle" },
          { ...baseAgent, id: "gwen", name: "Gwen Common", status: "idle" },
          {
            ...baseAgent,
            id: "paperclip-batch25",
            name: "Paperclip PMO",
            role: "CEO",
            metadata: { source: "pmo-agents" },
          },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /Show system/i }));
    expect(screen.getAllByText("Paperclip PMO").length).toBeGreaterThan(0);

    const names = screen.getAllByText(/Gwen Common|ZZ Directory/).map((el) => el.textContent);
    expect(names.indexOf("Gwen Common")).toBeLessThan(names.indexOf("ZZ Directory"));
  });

  it("speaks successful chat replies when voice capture returns a transcript", async () => {
    class SpeakAudio {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      pause = vi.fn();
      play = vi.fn().mockImplementation(async () => {
        this.onended?.();
      });
    }
    vi.stubGlobal("Audio", SpeakAudio);

    class MockRecognition {
      continuous = false;
      interimResults = false;
      lang = "en-US";
      onresult: ((event: { results: Array<Array<{ transcript: string }>> }) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        this.onresult?.({ results: [[{ transcript: "spoken batch25 prompt" }]] });
        this.onend?.();
      }
      stop() {
        this.onend?.();
      }
    }
    vi.stubGlobal("SpeechRecognition", MockRecognition);
    vi.stubGlobal("webkitSpeechRecognition", MockRecognition);

    vi.mocked(useAgents).mockReturnValue({
      data: { agents: [{ ...baseAgent, id: "voice-batch25", name: "Voice Batch25", status: "active", platform: "codex" }] },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/api/chat")) {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"text":"spoken batch25 reply"}\n\n'));
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

    await waitFor(() => expect(screen.getByText("spoken batch25 reply")).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith("/api/tts", expect.objectContaining({ method: "POST" }));
  });

  it("records per-agent meeting failures without aborting the room round", async () => {
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [
          { ...baseAgent, id: "room-a-batch25", name: "Room A", status: "active", platform: "codex" },
          { ...baseAgent, id: "room-b-batch25", name: "Room B", status: "active", platform: "codex" },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    let chatCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        if (String(input).includes("/api/chat")) {
          chatCalls += 1;
          if (chatCalls === 1) {
            return { ok: false, status: 502, text: async () => '{"message":"room batch25 down"}' };
          }
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"text":"room batch25 ok"}\n\n'));
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

    await waitFor(() => expect(screen.getByText(/room batch25 down/i)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("room batch25 ok")).toBeInTheDocument());
  });
});
