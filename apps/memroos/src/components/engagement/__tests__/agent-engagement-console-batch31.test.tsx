/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/components/dispatch/lineage-drawer", () => ({ LineageDrawer: () => null }));
vi.mock("@/lib/api-client", () => ({ useAgents: vi.fn(), useDelegations: vi.fn() }));

import { useAgents, useDelegations } from "@/lib/api-client";
import { AgentEngagementConsole } from "../agent-engagement-console";

const baseAgent = {
  name: "Batch31 Agent",
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
  vi.mocked(useDelegations).mockReturnValue({ data: { delegations: [] }, isLoading: false } as ReturnType<
    typeof useDelegations
  >);
  URL.createObjectURL = vi.fn(() => "blob:engagement-batch31");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AgentEngagementConsole batch31", () => {
  it("sortAgents orders two common roster ids by COMMON_AGENT_IDS index (line 157)", () => {
    const suffix = randomUUID().slice(0, 8);
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [
          { ...baseAgent, id: "sophia", name: `Sophia ${suffix}`, status: "active" },
          { ...baseAgent, id: "alba", name: `Alba ${suffix}`, status: "active" },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    render(<AgentEngagementConsole />);
    const articles = screen.getAllByRole("article");
    const text = articles.map((el) => el.textContent ?? "");
    const albaIdx = text.findIndex((t) => t.includes(`Alba ${suffix}`));
    const sophiaIdx = text.findIndex((t) => t.includes(`Sophia ${suffix}`));
    expect(albaIdx).toBeGreaterThanOrEqual(0);
    expect(sophiaIdx).toBeGreaterThanOrEqual(0);
    expect(albaIdx).toBeLessThan(sophiaIdx);
  });

  it("sendChatMessage ignores whitespace-only drafts (line 343)", async () => {
    const suffix = randomUUID().slice(0, 8);
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [{ ...baseAgent, id: `chat-b31-${suffix}`, name: `Chat B31 ${suffix}`, status: "active" }],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentEngagementConsole />);
    fireEvent.change(screen.getByPlaceholderText(new RegExp(`Message Chat B31 ${suffix}`, "i")), {
      target: { value: "   \n\t  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/chat")).length).toBe(0),
    );
  });

  it("speak plays TTS after a voiced chat reply (lines 318-336)", async () => {
    const suffix = randomUUID().slice(0, 8);
    class MockRecognition {
      continuous = false;
      interimResults = false;
      lang = "en-US";
      onresult: ((event: { results: Array<{ 0: { transcript: string } }> }) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start = vi.fn(() => {
        this.onresult?.({ results: [{ 0: { transcript: "voice batch31 prompt" } }] });
        this.onend?.();
      });
      stop = vi.fn();
    }
    vi.stubGlobal("SpeechRecognition", MockRecognition);
    vi.stubGlobal("webkitSpeechRecognition", MockRecognition);

    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [{ ...baseAgent, id: `voice-b31-${suffix}`, name: `Voice B31 ${suffix}`, status: "active" }],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    const play = vi.fn().mockResolvedValue(undefined);
    class MockAudio {
      pause = vi.fn();
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      play = play;
    }
    vi.stubGlobal("Audio", MockAudio);

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      if (String(input).includes("/api/chat")) {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"text":"spoken reply batch31"}\n\n'));
            controller.close();
          },
        });
        return { ok: true, body: stream };
      }
      if (String(input).includes("/api/tts")) {
        return { ok: true, blob: async () => new Blob(["audio-b31"]) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: "Speak to agent" }));

    await waitFor(() => expect(screen.getByText(/spoken reply batch31/)).toBeInTheDocument());
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/tts")).length).toBe(1),
    );
    expect(play).toHaveBeenCalled();
  });

  it("runAgentTests surfaces non-Error rejections (lines 494-495)", async () => {
    const suffix = randomUUID().slice(0, 8);
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [{ ...baseAgent, id: `net-b31-${suffix}`, name: `Net B31 ${suffix}`, status: "active" }],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        if (String(input).includes("/api/engagement/test") && init?.method === "POST") {
          return Promise.reject("plain-string-reject-batch31");
        }
        return { ok: true, json: async () => ({}) };
      }),
    );

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /Test primary agents/i }));
    await waitFor(() =>
      expect(screen.getByText(/Agent test failed — network error/i)).toBeInTheDocument(),
    );
  });
});
