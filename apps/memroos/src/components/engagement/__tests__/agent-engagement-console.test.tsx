import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

vi.mock("@/components/dispatch/lineage-drawer", () => ({
  LineageDrawer: ({ taskId }: { taskId: string }) => <button type="button">Timeline {taskId}</button>,
}));

const mockRefetchDelegations = vi.fn();
const mockAgents = [
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
  {
    id: "codex-cli-agent",
    name: "Codex CLI",
    role: "Agent",
    platform: "codex",
    protocol: "local",
    status: "idle",
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
    id: "paperclip",
    name: "Paperclip",
    role: "Paperclip orchestrator",
    platform: "codex",
    protocol: "local",
    status: "idle",
    lastHeartbeat: null,
    currentTask: null,
    lessonsCount: 0,
    todayMemoryCount: 0,
    location: "local",
    isRemote: false,
    latencyMs: null,
    capabilities: [],
    metadata: { source: "pmo-agents" },
    host: null,
    port: null,
    healthEndpoint: null,
    tunnelUrl: null,
    createdAt: "2026-05-11T00:00:00Z",
    updatedAt: "2026-05-11T00:00:00Z",
    deregisteredAt: null,
  },
  {
    id: "ceo",
    name: "CEO",
    role: "CEO Agent",
    platform: "codex",
    protocol: "local",
    status: "dormant",
    lastHeartbeat: null,
    currentTask: null,
    lessonsCount: 0,
    todayMemoryCount: 0,
    location: "local",
    isRemote: false,
    latencyMs: null,
    capabilities: [],
    metadata: { source: "pmo-agents" },
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
  useAgents: vi.fn(() => ({ data: { agents: mockAgents }, isLoading: false })),
  useDelegations: () => ({
    data: {
      delegations: [{
        task_id: "t1",
        task_summary: "existing task",
        status: "pending",
      }],
    },
    refetch: mockRefetchDelegations,
  }),
}));

import { AgentEngagementConsole } from "../agent-engagement-console";
import { useAgents } from "@/lib/api-client";

function chatStream(text: string): Response {
  return new Response(`data: ${JSON.stringify({ text })}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAgents).mockReturnValue({ data: { agents: mockAgents }, isLoading: false } as ReturnType<typeof useAgents>);
  vi.stubGlobal("fetch", vi.fn());
});

describe("AgentEngagementConsole", () => {
  it("renders direct chat plus one unified room mode", () => {
    render(<AgentEngagementConsole />);

    expect(screen.getByText("Agent Engagement")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Direct Chat" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Group Room" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Conference" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Claude Sonnet Engineer").length).toBeGreaterThan(0);
  });

  it("keeps dormant registered agents visible and excludes Paperclip agents from the roster", () => {
    render(<AgentEngagementConsole />);

    expect(screen.getAllByText("Claude Sonnet Engineer").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Codex CLI").length).toBeGreaterThan(0);
    expect(screen.getByText("1 active / 2 registered")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Show system \(2\)/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Paperclip support agents/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Paperclip")).not.toBeInTheDocument();
    expect(screen.queryByText("Paperclip orchestrator")).not.toBeInTheDocument();
    expect(screen.queryByText("CEO")).not.toBeInTheDocument();
    expect(screen.queryByText("CEO Agent")).not.toBeInTheDocument();
  });

  it("can explicitly show hidden Paperclip and PMO system agents", () => {
    render(<AgentEngagementConsole />);

    fireEvent.click(screen.getByRole("button", { name: /Show system \(2\)/i }));

    expect(screen.getByText("System / Paperclip")).toBeInTheDocument();
    expect(screen.getByText("Paperclip")).toBeInTheDocument();
    expect(screen.getByText("CEO")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Hide system/i })).toBeInTheDocument();
  });

  it("filters the agent roster by search text and status", () => {
    render(<AgentEngagementConsole />);

    fireEvent.change(screen.getByLabelText("Filter agents"), { target: { value: "codex" } });
    expect(screen.queryByText("Claude Sonnet Engineer")).not.toBeInTheDocument();
    expect(screen.getAllByText("Codex CLI").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Filter by agent status"), { target: { value: "active" } });
    expect(screen.getByText("No agents match the current filters.")).toBeInTheDocument();
  });

  it("runs diagnostics for primary agents without testing hidden Paperclip agents", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      json: async () => ({
        results: [{
          agentId: "claude-sonnet-engineer",
          name: "Claude Sonnet Engineer",
          status: "active",
          chat: {
            status: "warning",
            runner: "opencode",
            model: "bailian/qwen3.5-plus",
            source: "pmo-routing",
            fallbackRunner: "anthropic",
            detail: "Primary blocked; Anthropic fallback is configured.",
          },
          dispatch: { status: "ready", adapter: "hive-poll", detail: "queued" },
          voice: { status: "warning", detail: "missing key" },
        }],
      }),
    } as Response);

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /test primary agents/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/engagement/test", expect.objectContaining({ method: "POST" }));
      const [, init] = vi.mocked(fetch).mock.calls[0];
      expect(String(init?.body)).not.toContain("paperclip");
      expect(screen.getByText(/chat: Primary blocked; Anthropic fallback is configured./)).toBeInTheDocument();
      expect(screen.getByText(/model: opencode \/ bailian\/qwen3.5-plus/)).toBeInTheDocument();
    });
  });

  it("runs a 15-minute standup as a live room turn", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(chatStream("Runtime is healthy. No blockers."));

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: "Group Room" }));
    fireEvent.change(screen.getByLabelText(/Standup focus/i), {
      target: { value: "Memroos dispatch reliability" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Run 15-minute standup/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/chat", expect.objectContaining({ method: "POST" }));
      const [, init] = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(String(init?.body));
      expect(body.message).toContain("15-minute standup");
      expect(body.message).toContain("Yesterday");
      expect(body.message).toContain("Today");
      expect(body.message).toContain("Memroos dispatch reliability");
      expect(screen.getByText("Runtime is healthy. No blockers.")).toBeInTheDocument();
    });
  });

  it("shows obvious room actions above the form", () => {
    render(<AgentEngagementConsole />);

    fireEvent.click(screen.getByRole("button", { name: "Group Room" }));

    expect(screen.getByRole("button", { name: /Run 15-minute standup/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Start conference round/i })).toBeInTheDocument();
    expect(screen.getByText(/Room session/i)).toBeInTheDocument();
  });

  it("shows recent delegations in the sidebar", () => {
    render(<AgentEngagementConsole />);

    expect(screen.getByText("existing task")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Timeline t1" })).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
  });

  it("runs a conference round with the default prompt when the room message is blank", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(chatStream("Conference summary from the room."));

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: "Group Room" }));
    fireEvent.click(screen.getByRole("button", { name: /Start conference round/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/chat", expect.objectContaining({ method: "POST" }));
      const [, init] = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(String(init?.body));
      expect(body.message).toContain("group conference round");
      expect(screen.getByText("Conference summary from the room.")).toBeInTheDocument();
    });
  });

  it("includes standup blockers and operator ask in the standup prompt", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(chatStream("Blocked on deploy access."));

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: "Group Room" }));
    fireEvent.change(screen.getByLabelText(/Standup focus/i), { target: { value: "Dispatch reliability" } });
    fireEvent.change(screen.getByPlaceholderText(/Anything blocked or stale/i), {
      target: { value: "Heroku token expired" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Reply with status, next step/i), {
      target: { value: "Name the next unblocker" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Run 15-minute standup/i }));

    await waitFor(() => {
      const [, init] = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(String(init?.body));
      expect(body.message).toContain("Known blockers: Heroku token expired");
      expect(body.message).toContain("Operator ask: Name the next unblocker");
    });
  });

  it("surfaces chat stream failures in the transcript", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('{"error":{"message":"Provider unavailable"}}', { status: 503 }),
    );

    render(<AgentEngagementConsole />);
    fireEvent.change(screen.getByLabelText("Direct message"), { target: { value: "ping" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(screen.getByText(/Chat unavailable: Provider unavailable/)).toBeInTheDocument();
    });
  });

  it("surfaces engagement test network failures", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network down"));

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /test primary agents/i }));

    await waitFor(() => {
      expect(screen.getByText("network down")).toBeInTheDocument();
    });
  });

  it("runs diagnostics for a single agent from the roster card", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      json: async () => ({
        results: [{
          agentId: "codex-cli-agent",
          name: "Codex CLI",
          status: "idle",
          chat: { status: "ready", runner: "codex", model: "gpt-4.1", detail: "ready" },
          dispatch: { status: "ready", adapter: "hive-poll", detail: "queued" },
          voice: { status: "ready", detail: "ok" },
        }],
      }),
    } as Response);

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getAllByRole("button", { name: "Test" })[1]);

    await waitFor(() => {
      const [, init] = vi.mocked(fetch).mock.calls[0];
      expect(String(init?.body)).toContain("codex-cli-agent");
    });
  });

  it("toggles room participation from an agent card", () => {
    render(<AgentEngagementConsole />);

    expect(screen.getByText(/1 participant/)).toBeInTheDocument();
    const roomButtons = screen.getAllByRole("button", { name: /Room/i });
    fireEvent.click(roomButtons[1]);

    expect(screen.getByText(/2 participants/)).toBeInTheDocument();
  });

  it("can hide system agents again after showing them", () => {
    render(<AgentEngagementConsole />);

    fireEvent.click(screen.getByRole("button", { name: /Show system \(2\)/i }));
    expect(screen.getByText("CEO")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Hide system/i }));
    expect(screen.queryByText("CEO")).not.toBeInTheDocument();
  });

  it("sends direct chat on Enter without Shift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(chatStream("Enter key works"));

    render(<AgentEngagementConsole />);
    const textarea = screen.getByLabelText("Direct message");
    fireEvent.change(textarea, { target: { value: "via enter" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      expect(screen.getByText("Enter key works")).toBeInTheDocument();
    });
  });

  it("records a system message when voice capture is unsupported in room mode", () => {
    const originalSpeechRecognition = window.SpeechRecognition;
    // @ts-expect-error test cleanup
    delete window.SpeechRecognition;
    // @ts-expect-error test cleanup
    delete window.webkitSpeechRecognition;

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: "Group Room" }));
    fireEvent.click(screen.getByRole("button", { name: "Speak to room" }));

    expect(
      screen.getByText(/Voice capture is not supported in this browser/i),
    ).toBeInTheDocument();

    window.SpeechRecognition = originalSpeechRecognition;
  });

  it("scopes direct chat history and payload to the selected agent", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(chatStream("Claude response"))
      .mockResolvedValueOnce(chatStream("Codex response"));

    render(<AgentEngagementConsole />);

    fireEvent.change(screen.getByLabelText("Direct message"), { target: { value: "first" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(screen.getByText("Claude response")).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText("Codex CLI")[0].closest("button") as HTMLButtonElement);

    expect(screen.queryByText("Claude response")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Direct message"), { target: { value: "second" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      const [, init] = vi.mocked(fetch).mock.calls[1];
      const body = JSON.parse(String(init?.body));
      expect(body.agentId).toBe("codex-cli-agent");
      expect(body.history).toEqual([]);
      expect(screen.getByText("Codex response")).toBeInTheDocument();
    });
  });

  it("filters the roster by search query", () => {
    render(<AgentEngagementConsole />);
    fireEvent.change(screen.getByLabelText("Filter agents"), { target: { value: "codex" } });
    expect(screen.getAllByText("Codex CLI").length).toBeGreaterThan(0);
    expect(screen.queryByText("Claude Sonnet Engineer")).not.toBeInTheDocument();
  });

  it("filters the roster by agent status", () => {
    render(<AgentEngagementConsole />);
    fireEvent.change(screen.getByLabelText("Filter by agent status"), { target: { value: "active" } });
    expect(screen.getAllByText("Claude Sonnet Engineer").length).toBeGreaterThan(0);
    expect(screen.queryByText("Codex CLI")).not.toBeInTheDocument();
  });

  it("invokes TTS after voice capture delivers a transcript in direct chat", async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    class MockAudio {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      play = play;
      pause = vi.fn();
    }
    vi.stubGlobal("Audio", MockAudio as unknown as typeof Audio);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:tts"),
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
        this.onresult?.({ results: [{ 0: { transcript: "voice hello" } }] });
        this.onend?.();
      }
      stop() {}
    }
    vi.stubGlobal("SpeechRecognition", MockRecognition as unknown as typeof SpeechRecognition);
    vi.stubGlobal("webkitSpeechRecognition", MockRecognition as unknown as typeof SpeechRecognition);

    vi.mocked(fetch)
      .mockResolvedValueOnce(chatStream("spoken reply"))
      .mockResolvedValueOnce({
        ok: true,
        blob: async () => new Blob(["audio"]),
      } as Response);

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByLabelText("Speak to agent"));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/tts", expect.objectContaining({ method: "POST" }));
      expect(play).toHaveBeenCalled();
    });
  });

  it("shows loading state while agents are fetching", () => {
    vi.mocked(useAgents).mockReturnValueOnce({ data: undefined, isLoading: true } as ReturnType<typeof useAgents>);
    render(<AgentEngagementConsole />);
    expect(screen.getByText("Loading agents...")).toBeInTheDocument();
  });

  it("parses stream payload errors embedded in SSE data lines", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        'data: {"error":"{\\"message\\":\\"rate limited\\"}"}\n\n',
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      )
    );

    render(<AgentEngagementConsole />);
    fireEvent.change(screen.getByLabelText("Direct message"), { target: { value: "boom" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(screen.getByText(/Chat unavailable/i)).toBeInTheDocument();
    });
  });

  it("shows default model labels and fallback routing after diagnostics", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      json: async () => ({
        results: [{
          agentId: "claude-sonnet-engineer",
          name: "Claude Sonnet Engineer",
          status: "active",
          chat: {
            status: "warning",
            runner: "opencode",
            model: "bailian/qwen3.5-plus",
            fallbackRunner: "anthropic",
            fallbackModel: "claude-sonnet-4-6",
            detail: "fallback ready",
          },
          dispatch: { status: "ready", adapter: "hive-poll", detail: "queued" },
          voice: { status: "ready", detail: "ok" },
        }],
      }),
    } as Response);

    render(<AgentEngagementConsole />);
    expect(screen.getAllByText(/model: claude-sonnet-4-6|model: opencode/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /test primary agents/i }));

    await waitFor(() => {
      expect(screen.getByText(/hive-poll \/ opencode -> anthropic\/claude-sonnet-4-6/)).toBeInTheDocument();
    });
  });

  it("renders directory agents and error-status pills outside the primary roster", () => {
    const directoryAgent = {
      ...mockAgents[1],
      id: "directory-only-agent",
      name: "Directory Only",
      role: "Support",
      status: "error" as const,
    };
    vi.mocked(useAgents).mockReturnValue({
      data: { agents: [...mockAgents, directoryAgent] },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    render(<AgentEngagementConsole />);
    expect(screen.getByText("Registered directory")).toBeInTheDocument();
    expect(screen.getByText("Directory Only")).toBeInTheDocument();
    expect(screen.getAllByText("error").length).toBeGreaterThan(0);
  });

  it("uses active and all participant presets in room mode", async () => {
    vi.mocked(fetch).mockResolvedValue(chatStream("Room preset reply"));

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: "Group Room" }));
    fireEvent.click(screen.getByRole("button", { name: "Use all" }));

    expect(screen.getByText(/2 participants/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Start conference round/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalled();
      expect(screen.getByText("Room preset reply")).toBeInTheDocument();
    });
  });

  it("runs a multi-participant room round and surfaces per-agent failures", async () => {
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: mockAgents.map((agent) =>
          agent.id === "codex-cli-agent" ? { ...agent, status: "active" as const } : agent,
        ),
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    vi.mocked(fetch)
      .mockResolvedValueOnce(chatStream("First agent update."))
      .mockResolvedValueOnce(
        new Response('{"message":"room provider down"}', { status: 503 }),
      );

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: "Group Room" }));
    fireEvent.click(screen.getByRole("button", { name: /Start conference round/i }));

    await waitFor(() => {
      expect(screen.getByText("First agent update.")).toBeInTheDocument();
      expect(screen.getByText(/Chat unavailable/i)).toBeInTheDocument();
    });
  });

  it("ignores TTS failures without blocking chat", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(chatStream("spoken reply"))
      .mockResolvedValueOnce(new Response("tts down", { status: 503 }));

    render(<AgentEngagementConsole />);
    fireEvent.change(screen.getByLabelText("Direct message"), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(screen.getByText("spoken reply")).toBeInTheDocument();
    });
  });

  it("sorts common agents ahead of directory-only agents", () => {
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [
          {
            ...mockAgents[1],
            id: "directory-only-agent",
            name: "Directory Only",
            status: "idle",
          },
          mockAgents[0],
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    render(<AgentEngagementConsole />);
    const rosterButtons = screen.getAllByRole("button").filter((button) =>
      button.textContent?.includes("Claude Sonnet Engineer") || button.textContent?.includes("Directory Only"),
    );
    expect(rosterButtons[0]?.textContent).toContain("Claude Sonnet Engineer");
  });

  it("parses plain-text chat errors without embedded JSON", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("upstream unavailable", { status: 503 }),
    );

    render(<AgentEngagementConsole />);
    fireEvent.change(screen.getByLabelText("Direct message"), { target: { value: "ping" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(screen.getByText(/Chat unavailable: upstream unavailable/)).toBeInTheDocument();
    });
  });

  it("removes a room participant when toggled off", () => {
    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: "Group Room" }));
    fireEvent.click(screen.getByRole("button", { name: "Use all" }));
    expect(screen.getByText(/2 participants/)).toBeInTheDocument();

    const roomButtons = screen.getAllByRole("button", { name: /Room/i });
    fireEvent.click(roomButtons[1]);
    expect(screen.getByText(/1 participant/)).toBeInTheDocument();
  });

  it("resets room participants to the active preset", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(chatStream("Active preset reply"));

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: "Group Room" }));
    fireEvent.click(screen.getByRole("button", { name: "Use all" }));
    fireEvent.click(screen.getByRole("button", { name: "Use active" }));
    fireEvent.click(screen.getByRole("button", { name: /Start conference round/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalled();
      expect(screen.getByText("Active preset reply")).toBeInTheDocument();
    });
  });

  it("runs spoken room prompts with voice playback in room mode", async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    class MockAudio {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      play = play;
      pause = vi.fn();
    }
    vi.stubGlobal("Audio", MockAudio as unknown as typeof Audio);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:room-tts"),
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
        this.onresult?.({ results: [{ 0: { transcript: "room voice prompt" } }] });
        this.onend?.();
      }
      stop() {}
    }
    vi.stubGlobal("SpeechRecognition", MockRecognition as unknown as typeof SpeechRecognition);
    vi.stubGlobal("webkitSpeechRecognition", MockRecognition as unknown as typeof SpeechRecognition);

    vi.mocked(fetch)
      .mockResolvedValueOnce(chatStream("Room voice reply"))
      .mockResolvedValueOnce({ ok: true, blob: async () => new Blob(["audio"]) } as Response);

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: "Group Room" }));
    fireEvent.click(screen.getByRole("button", { name: "Speak to room" }));

    await waitFor(() => {
      expect(screen.getByText("Room voice reply")).toBeInTheDocument();
      expect(fetch).toHaveBeenCalledWith("/api/tts", expect.any(Object));
    });
  });

  it("handles speech recognition errors in room mode", () => {
    class MockRecognition {
      continuous = false;
      interimResults = false;
      lang = "en-US";
      onresult: ((event: { results: Array<{ 0: { transcript: string } }> }) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        this.onerror?.();
        this.onend?.();
      }
      stop() {}
    }
    vi.stubGlobal("SpeechRecognition", MockRecognition as unknown as typeof SpeechRecognition);
    vi.stubGlobal("webkitSpeechRecognition", MockRecognition as unknown as typeof SpeechRecognition);

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: "Group Room" }));
    fireEvent.click(screen.getByRole("button", { name: "Speak to room" }));

    expect(screen.queryByText(/Listening/i)).not.toBeInTheDocument();
  });

  it("tolerates agents whose metadata cannot be stringified", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [
          {
            ...mockAgents[0],
            metadata: circular,
          },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    render(<AgentEngagementConsole />);
    expect(screen.getAllByText("Claude Sonnet Engineer").length).toBeGreaterThan(0);
  });

  it("parses malformed JSON chat error payloads safely", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("{not-json", { status: 503 }),
    );

    render(<AgentEngagementConsole />);
    fireEvent.change(screen.getByLabelText("Direct message"), { target: { value: "ping" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(screen.getByText(/Chat unavailable: \{not-json/)).toBeInTheDocument();
    });
  });

  it("stops an active voice capture session when Speak is clicked again", () => {
    const stop = vi.fn();
    class MockRecognition {
      continuous = false;
      interimResults = false;
      lang = "en-US";
      onresult: ((event: { results: Array<{ 0: { transcript: string } }> }) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start = vi.fn();
      stop = stop;
    }
    vi.stubGlobal("SpeechRecognition", MockRecognition as unknown as typeof SpeechRecognition);
    vi.stubGlobal("webkitSpeechRecognition", MockRecognition as unknown as typeof SpeechRecognition);

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByLabelText("Speak to agent"));
    fireEvent.click(screen.getByLabelText("Speak to agent"));

    expect(stop).toHaveBeenCalled();
  });
});
