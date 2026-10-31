/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/components/dispatch/lineage-drawer", () => ({
  LineageDrawer: () => null,
}));

const mockAgents = [
  {
    id: "codex-cli-agent",
    name: "Codex CLI",
    role: "Agent",
    platform: "codex",
    protocol: "local",
    status: "active",
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
  },
  {
    id: "claude-sonnet-engineer",
    name: "Claude Sonnet Engineer",
    role: "CLI engineer",
    platform: "claude",
    protocol: "local",
    status: "active",
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
  },
];

vi.mock("@/lib/api-client", () => ({
  useAgents: vi.fn(),
  useDelegations: vi.fn(() => ({
    data: { delegations: [] },
    isLoading: false,
  })),
}));

import { useAgents } from "@/lib/api-client";
import { AgentEngagementConsole } from "../agent-engagement-console";

function chatStream(text: string): Response {
  return new Response(`data: {"text":"${text}"}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAgents).mockReturnValue({
    data: { agents: mockAgents },
    isLoading: false,
  } as ReturnType<typeof useAgents>);
  vi.stubGlobal("fetch", vi.fn());
});

describe("AgentEngagementConsole batch16", () => {
  it("lists common agents in roster priority order (claude before codex)", () => {
    render(<AgentEngagementConsole />);
    const names = screen.getAllByText(/Claude Sonnet Engineer|Codex CLI/);
    const claudeIndex = names.findIndex((node) => node.textContent?.includes("Claude Sonnet Engineer"));
    const codexIndex = names.findIndex((node) => node.textContent?.includes("Codex CLI"));
    expect(claudeIndex).toBeGreaterThanOrEqual(0);
    expect(codexIndex).toBeGreaterThanOrEqual(0);
    expect(claudeIndex).toBeLessThan(codexIndex);
  });

  it("surfaces engagement test network errors from Test primary agents", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("batch16 engagement test offline"));
    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: "Test primary agents" }));
    await waitFor(() => {
      expect(screen.getByText("batch16 engagement test offline")).toBeInTheDocument();
    });
  });

  it("posts a single-agent diagnostic when an agent card Test button is clicked", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            agentId: "codex-cli-agent",
            name: "Codex CLI",
            status: "active",
            chat: { status: "ready", runner: "codex", detail: "ok" },
            dispatch: { status: "ready", adapter: "rest", detail: "ok" },
            voice: { status: "ready", detail: "ok" },
          },
        ],
      }),
    } as Response);

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getAllByRole("button", { name: "Test" })[0]);

    await waitFor(() => {
      const [url, init] = vi.mocked(fetch).mock.calls[0];
      expect(String(url)).toContain("/api/engagement/test");
      expect(String(init?.body)).toContain("claude-sonnet-engineer");
    });
  });

  it("parses JSON chat errors into assistant messages", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('{"error":{"message":"Provider quota exceeded for batch16"}}', {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<AgentEngagementConsole />);
    fireEvent.change(screen.getByLabelText("Direct message"), { target: { value: "hello batch16" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(screen.getByText(/Provider quota exceeded for batch16/)).toBeInTheDocument();
    });
  });

  it("ignores empty speech transcripts without sending chat", async () => {
    class MockRecognition {
      continuous = false;
      interimResults = false;
      lang = "en-US";
      onresult: ((event: { results: Array<{ 0: { transcript: string } }> }) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        this.onresult?.({ results: [{ 0: { transcript: "   " } }] });
        this.onend?.();
      }
      stop() {}
    }

    vi.stubGlobal("SpeechRecognition", MockRecognition as unknown as typeof SpeechRecognition);
    vi.stubGlobal("webkitSpeechRecognition", MockRecognition as unknown as typeof SpeechRecognition);

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /Speak to agent/i }));

    await waitFor(() => {
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  it("plays TTS after voice capture delivers a transcript in direct chat", async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    class MockAudio {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      play = play;
      pause = vi.fn();
    }
    vi.stubGlobal("Audio", MockAudio as unknown as typeof Audio);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:batch16-tts"),
      revokeObjectURL: vi.fn(),
    });

    class MockRecognition {
      continuous = false;
      interimResults = false;
      lang = "en-US";
      onresult: ((event: { results: Array<{ 0: { transcript: string } }> }) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        this.onresult?.({ results: [{ 0: { transcript: "batch16 voice send" } }] });
        this.onend?.();
      }
      stop() {}
    }
    vi.stubGlobal("SpeechRecognition", MockRecognition as unknown as typeof SpeechRecognition);
    vi.stubGlobal("webkitSpeechRecognition", MockRecognition as unknown as typeof SpeechRecognition);

    vi.mocked(fetch)
      .mockResolvedValueOnce(chatStream("Batch16 spoken reply"))
      .mockResolvedValueOnce({
        ok: true,
        blob: async () => new Blob(["audio"], { type: "audio/mpeg" }),
      } as Response);

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByLabelText("Speak to agent"));

    await waitFor(() => {
      const ttsCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes("/api/tts"));
      expect(ttsCall?.[1]?.body).toContain("Batch16 spoken reply");
      expect(play).toHaveBeenCalled();
    });
  });
});
