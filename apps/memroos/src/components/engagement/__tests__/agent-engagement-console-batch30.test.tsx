/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/components/dispatch/lineage-drawer", () => ({ LineageDrawer: () => null }));
vi.mock("@/lib/api-client", () => ({ useAgents: vi.fn(), useDelegations: vi.fn() }));

import { useAgents, useDelegations } from "@/lib/api-client";
import { AgentEngagementConsole } from "../agent-engagement-console";

const baseAgent = {
  name: "Batch30 Agent",
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
  URL.createObjectURL = vi.fn(() => "blob:engagement-batch30");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AgentEngagementConsole batch30", () => {
  it("sortAgents primary roster: custom active agents sort after common ids (line 155)", () => {
    const suffix = randomUUID().slice(0, 8);
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [
          { ...baseAgent, id: `aa-custom-${suffix}`, name: `AA Custom ${suffix}`, status: "active" },
          { ...baseAgent, id: `zz-custom-${suffix}`, name: `ZZ Custom ${suffix}`, status: "active" },
          { ...baseAgent, id: "sophia", name: `Sophia ${suffix}`, status: "active" },
          { ...baseAgent, id: "alba", name: `Alba ${suffix}`, status: "active" },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    render(<AgentEngagementConsole />);
    const articles = screen.getAllByRole("article");
    const names = articles.map((el) => el.textContent ?? "");
    const albaIdx = names.findIndex((t) => t.includes(`Alba ${suffix}`));
    const customIdx = names.findIndex((t) => t.includes(`ZZ Custom ${suffix}`));
    expect(albaIdx).toBeGreaterThanOrEqual(0);
    expect(customIdx).toBeGreaterThanOrEqual(0);
    expect(albaIdx).toBeLessThan(customIdx);
  });

  it("speak skips whitespace-only assistant text after voice chat (line 318)", async () => {
    class MockRecognition {
      continuous = false;
      interimResults = false;
      lang = "en-US";
      onresult: ((event: { results: Array<{ 0: { transcript: string } }> }) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start = vi.fn(() => {
        this.onresult?.({ results: [{ 0: { transcript: "voice batch30 prompt" } }] });
        this.onend?.();
      });
      stop = vi.fn();
    }
    vi.stubGlobal("SpeechRecognition", MockRecognition);
    vi.stubGlobal("webkitSpeechRecognition", MockRecognition);

    vi.mocked(useAgents).mockReturnValue({
      data: { agents: [{ ...baseAgent, id: "voice-b30", name: "Voice B30", status: "active" }] },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      if (String(input).includes("/api/chat")) {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"text":"   "}\n\n'));
            controller.close();
          },
        });
        return { ok: true, body: stream };
      }
      if (String(input).includes("/api/tts")) {
        return { ok: true, blob: async () => new Blob(["audio"]) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: "Speak to agent" }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/chat")).length).toBe(1),
    );
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/tts")).length).toBe(0);
  });

  it("runMeetingRound busy guard rejects overlapping room send (line 393)", async () => {
    const suffix = randomUUID().slice(0, 8);
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [
          { ...baseAgent, id: `room-busy-a-${suffix}`, name: `Room Busy A ${suffix}`, status: "active" },
          { ...baseAgent, id: `room-busy-b-${suffix}`, name: `Room Busy B ${suffix}`, status: "active" },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    let resolveChat: (v: Response) => void = () => {};
    const chatPromise = new Promise<Response>((resolve) => {
      resolveChat = resolve;
    });

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      if (String(input).includes("/api/chat")) return chatPromise;
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /Group Room/i }));
    fireEvent.change(screen.getByPlaceholderText(/Ask the room something/i), {
      target: { value: "first room prompt batch30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send room prompt" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Send room prompt" })).toBeDisabled());

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/Ask the room something/i), {
        target: { value: "second room prompt should be ignored" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Send room prompt" }));
    });

    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/chat")).length).toBe(1);

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"text":"ok-room-b30"}\n\n'));
        controller.close();
      },
    });
    resolveChat({ ok: true, body: stream } as Response);
    await waitFor(() => expect(screen.getByText(/ok-room-b30/)).toBeInTheDocument());
  });

  it("runAgentTests with explicit primary ids still merges checks (line 482 body)", async () => {
    const suffix = randomUUID().slice(0, 8);
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [{ ...baseAgent, id: `diag-b30-${suffix}`, name: `Diag B30 ${suffix}`, status: "active" }],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        if (String(input).includes("/api/engagement/test") && init?.method === "POST") {
          return {
            ok: true,
            json: async () => ({
              results: [
                {
                  agentId: `diag-b30-${suffix}`,
                  name: `Diag B30 ${suffix}`,
                  status: "active",
                  chat: { status: "ready", detail: "ok", runner: "codex" },
                  dispatch: { status: "ready", detail: "local", adapter: "local" },
                  voice: { status: "ready", detail: `voice-ok-b30-${suffix}` },
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
    await waitFor(() => expect(screen.getByText(new RegExp(`voice-ok-b30-${suffix}`))).toBeInTheDocument());
  });
});
