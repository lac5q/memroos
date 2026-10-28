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
  vi.stubGlobal(
    "Audio",
    class MockAudio {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      pause = vi.fn();
      async play() {
        this.onended?.();
      }
    },
  );
  URL.createObjectURL = vi.fn(() => "blob:batch20b-mock");
  URL.revokeObjectURL = vi.fn();
});

describe("AgentEngagementConsole batch20b — sticky chat, voice, tests, room", () => {
  it("surfaces parseChatError JSON when direct chat HTTP fails", async () => {
    mockAgents([baseAgent]);
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/chat")) {
        return new Response('prefix {"error":{"message":"Provider quota exceeded"}}', { status: 429 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /Direct Chat/i }));
    fireEvent.change(screen.getByLabelText("Direct message"), {
      target: { value: "Hello operator" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(screen.getByText(/Provider quota exceeded/i)).toBeInTheDocument();
    });
  });

  it("streams assistant text and tolerates TTS failure after spoken chat", async () => {
    mockAgents([baseAgent]);
    const encoder = new TextEncoder();
    class MockRecognition {
      continuous = false;
      interimResults = false;
      lang = "en-US";
      onresult: ((event: { results: Array<Array<{ transcript: string }>> }) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        this.onresult?.({ results: [[{ transcript: "Speak back" }]] });
        this.onend?.();
      }
      stop() {
        this.onend?.();
      }
    }
    vi.stubGlobal("SpeechRecognition", MockRecognition);
    vi.stubGlobal("webkitSpeechRecognition", MockRecognition);

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/chat")) {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"text":"Hi Luis"}\n\n'));
            controller.close();
          },
        });
        return new Response(stream, { status: 200 });
      }
      if (url.includes("/api/tts")) {
        return new Response("nope", { status: 503 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /Direct Chat/i }));
    fireEvent.click(screen.getByRole("button", { name: "Speak to agent" }));

    await waitFor(() => {
      expect(screen.getByText(/Hi Luis/i)).toBeInTheDocument();
    });
  });

  it("runs agent tests and records engagement check results", async () => {
    mockAgents([baseAgent]);
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/engagement/test")) {
        return new Response(
          JSON.stringify({
            results: [
              {
                agentId: baseAgent.id,
                name: baseAgent.name,
                status: "active",
                chat: {
                  status: "ready",
                  runner: "anthropic",
                  model: "claude-test",
                  detail: "ok",
                },
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
    fireEvent.click(screen.getByRole("button", { name: /Test primary agents/i }));

    await waitFor(() => {
      expect(screen.getByText(/anthropic \/ claude-test/i)).toBeInTheDocument();
    });
  });

  it("shows network test errors and room transcript speaker labels", async () => {
    const roomMate = {
      ...baseAgent,
      id: "gemini-senior-engineer",
      name: "Gemini Engineer",
      platform: "gemini" as const,
    };
    mockAgents([baseAgent, roomMate]);
    let chatCalls = 0;
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/engagement/test")) {
        return Promise.reject(new Error("engagement offline"));
      }
      if (url.includes("/api/chat")) {
        chatCalls += 1;
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(`data: {"text":"Turn ${chatCalls} update"}\n\n`),
            );
            controller.close();
          },
        });
        return new Response(stream, { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Test$/i })[0]!);
    await waitFor(() => {
      expect(screen.getByText(/engagement offline/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Group Room/i }));
    fireEvent.change(screen.getByLabelText("Room prompt"), {
      target: { value: "Quick sync" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send room prompt" }));

    await waitFor(() => {
      expect(screen.getByText(/Turn 1 update/i)).toBeInTheDocument();
    });
  });

  it("orders common roster agents ahead of directory-only agents", () => {
    mockAgents([
      {
        ...baseAgent,
        id: "zzz-directory-agent",
        name: "Z Directory",
        status: "idle",
      },
      {
        ...baseAgent,
        id: "codex-cli-agent",
        name: "Codex Agent",
        status: "idle",
      },
    ]);

    render(<AgentEngagementConsole />);
    const names = screen.getAllByText(/Codex Agent|Z Directory/i).map((node) => node.textContent);
    expect(names.indexOf("Codex Agent")).toBeLessThan(names.indexOf("Z Directory"));
  });
});
