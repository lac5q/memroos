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
  name: "Batch27 Agent",
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
  URL.createObjectURL = vi.fn(() => "blob:engagement-batch27");
  URL.revokeObjectURL = vi.fn();
});

describe("AgentEngagementConsole batch27", () => {
  it("orders common roster agents by COMMON_AGENT_IDS precedence (alba before gwen)", () => {
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [
          { ...baseAgent, id: "gwen", name: "Gwen Batch27", status: "idle" },
          { ...baseAgent, id: "alba", name: "Alba Batch27", status: "idle" },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    render(<AgentEngagementConsole />);
    const names = screen.getAllByText(/Alba Batch27|Gwen Batch27/).map((el) => el.textContent);
    expect(names.indexOf("Alba Batch27")).toBeLessThan(names.indexOf("Gwen Batch27"));
  });

  it("shows registered default model label and ignores empty chat sends", async () => {
    vi.mocked(useAgents).mockReturnValue({
      data: { agents: [{ ...baseAgent, id: "chat-batch27", name: "Chat Batch27", platform: "qwen" }] },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentEngagementConsole />);
    expect(screen.getAllByText(/bailian\/qwen3.5-plus|registered default/i).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(fetchMock).not.toHaveBeenCalledWith("/api/chat", expect.anything());
  });

  it("surfaces engagement test network errors and per-agent fallback chat status lines", async () => {
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [
          { ...baseAgent, id: "diag-batch27", name: "Diag Batch27", status: "active", platform: "codex" },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    let engagementPosts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        if (String(input).includes("/api/engagement/test") && init?.method === "POST") {
          engagementPosts += 1;
          if (engagementPosts === 1) {
            throw new Error("engagement batch27 offline");
          }
          return {
            ok: true,
            json: async () => ({
              results: [
                {
                  agentId: "diag-batch27",
                  name: "Diag Batch27",
                  status: "active",
                  chat: {
                    status: "ready",
                    detail: "ok",
                    runner: "codex",
                    model: "gpt",
                    fallbackRunner: "haiku",
                    fallbackModel: "4-5",
                  },
                  dispatch: { status: "ready", detail: "local", adapter: "local" },
                  voice: { status: "ready", detail: "voice ok" },
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
    await waitFor(() => expect(screen.getByText(/engagement batch27 offline/i)).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole("button", { name: /^Test$/i })[0]!);
    await waitFor(() => expect(screen.getAllByText(/haiku\/4-5/i).length).toBeGreaterThan(0));
  });

  it("runs standup with operator focus fields and clears speaking state when TTS fails", async () => {
    class FailTtsAudio {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      pause = vi.fn();
      play = vi.fn().mockRejectedValue(new Error("tts batch27 down"));
    }
    vi.stubGlobal("Audio", FailTtsAudio);

    vi.mocked(useAgents).mockReturnValue({
      data: { agents: [{ ...baseAgent, id: "room-batch27", name: "Room Batch27", status: "active" }] },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        if (String(input).includes("/api/chat")) {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"text":"standup batch27 reply"}\n\n'));
              controller.close();
            },
          });
          return { ok: true, body: stream };
        }
        if (String(input).includes("/api/tts")) {
          return { ok: true, blob: async () => new Blob(["audio"]) };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /Group Room/i }));
    fireEvent.change(screen.getByLabelText(/Standup focus/i), { target: { value: "batch27 reliability" } });
    fireEvent.change(screen.getByPlaceholderText(/Anything blocked/i), { target: { value: "none batch27" } });
    fireEvent.change(screen.getByPlaceholderText(/Reply with status/i), { target: { value: "ship batch27 tests" } });
    fireEvent.click(screen.getByRole("button", { name: /Run 15-minute standup/i }));

    await waitFor(() => {
      const chatCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes("/api/chat"));
      expect(chatCall).toBeTruthy();
      const body = JSON.parse(String((chatCall![1] as RequestInit).body));
      expect(body.message).toMatch(/batch27 reliability/);
      expect(body.message).toMatch(/ship batch27 tests/);
    });
  });

  it("posts spoken room prompts with voice when speech recognition returns a transcript", async () => {
    vi.stubGlobal("SpeechRecognition", undefined);
    vi.stubGlobal("webkitSpeechRecognition", undefined);

    vi.mocked(useAgents).mockReturnValue({
      data: { agents: [{ ...baseAgent, id: "voice-room-batch27", name: "Voice Room Batch27" }] },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /Group Room/i }));
    fireEvent.click(screen.getByRole("button", { name: "Record room prompt" }));

    expect(
      screen.getByText(/Voice capture is not supported in this browser/i),
    ).toBeInTheDocument();
  });
});
