import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// JSDOM doesn't implement scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn();

vi.mock("@/lib/api-client", () => ({
  useAgents: vi.fn(),
}));

import { VoicePanel } from "@/components/voice/VoicePanel";
import { useAgents } from "@/lib/api-client";

const mockUseAgents = vi.mocked(useAgents);

const FIXTURE_AGENTS = [
  {
    id: "claude-sonnet-engineer",
    name: "Claude Sonnet Engineer",
    role: "SOUL.md -- Claude Sonnet Engineer",
    company: null,
    platform: "claude",
    protocol: "local",
    metadata: { source: "pmo-agents", path: "/Users/yourname/github/PMO/agents/claude-sonnet-engineer" },
  },
  {
    id: "content-creator",
    name: "Content Creator",
    role: "SOUL.md -- content-creator",
    company: null,
    platform: "codex",
    protocol: "local",
    metadata: { source: "pmo-agents", path: "/Users/yourname/github/PMO/agents/content-creator" },
  },
  {
    id: "sophia",
    name: "Sophia",
    role: "Sous Chef (Marketing)",
    company: "Epilogue",
    platform: "openclaw",
    protocol: "rest",
    metadata: { source: "agents.config.json" },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mockUseAgents.mockReturnValue({
    data: { agents: FIXTURE_AGENTS },
  } as ReturnType<typeof useAgents>);
});

describe("VoicePanel", () => {
  it("renders header and agent selector", () => {
    render(<VoicePanel />);
    expect(screen.getByText("Voice & Chat")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("labels CLIs, Paperclip project agents, and runtime subagents distinctly", () => {
    render(<VoicePanel />);
    expect(screen.getByRole("option", { name: "Claude CLI - Sonnet Engineer" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "PC (PMO) - Content Creator" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "OpenClaw subagent - Sophia" })).toBeInTheDocument();
  });

  it("shows chat and voice tab buttons", () => {
    render(<VoicePanel />);
    expect(screen.getByRole("button", { name: "chat" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "voice" })).toBeInTheDocument();
  });

  it("shows empty-state prompt for selected agent on chat tab", () => {
    render(<VoicePanel />);
    // default agent is first in sorted list
    expect(screen.getByText(/Ask .* what they're working on/)).toBeInTheDocument();
  });

  it("switches to voice tab and shows mic button", () => {
    render(<VoicePanel />);
    fireEvent.click(screen.getByRole("button", { name: "voice" }));
    expect(screen.getByRole("button", { name: "Start listening" })).toBeInTheDocument();
  });

  it("renders textarea on chat tab with agent name in placeholder", () => {
    render(<VoicePanel />);
    const textarea = screen.getByPlaceholderText(/Message .* \(Enter to send\)/);
    expect(textarea).toBeInTheDocument();
  });

  it("collapses and hides content when toggle clicked", () => {
    render(<VoicePanel />);
    expect(screen.getByRole("button", { name: "chat" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));

    expect(screen.queryByRole("button", { name: "chat" })).not.toBeInTheDocument();
  });

  it("expands again after collapse", () => {
    render(<VoicePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByRole("button", { name: "chat" })).toBeInTheDocument();
  });

  it("shows provider rate limits as a readable chat error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"error":"{\\"type\\":\\"error\\",\\"error\\":{\\"type\\":\\"rate_limit_error\\",\\"message\\":\\"usage limit exceeded\\"}}"}\n\n'
              )
            );
            controller.close();
          },
        }),
      })
    );

    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message .* \(Enter to send\)/), {
      target: { value: "test" },
    });
    fireEvent.keyDown(screen.getByPlaceholderText(/Message .* \(Enter to send\)/), {
      key: "Enter",
      code: "Enter",
    });

    await waitFor(() => {
      expect(screen.getByText(/Provider limit hit: usage limit exceeded/)).toBeInTheDocument();
    });
  });

  it("renders no agents gracefully when useAgents returns empty", () => {
    mockUseAgents.mockReturnValue({ data: { agents: [] } } as ReturnType<typeof useAgents>);
    render(<VoicePanel />);
    expect(screen.getByText("Voice & Chat")).toBeInTheDocument();
  });

  it("sends chat via the send button and renders the streamed assistant reply", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('data: {"text":"All systems nominal"}\n\ndata: [DONE]\n\n'),
            );
            controller.close();
          },
        }),
      }),
    );

    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message .* \(Enter to send\)/), {
      target: { value: "status check" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByText("All systems nominal")).toBeInTheDocument();
    });
  });

  it("shows OpenCode disabled guidance in chat errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => "OpenCode chat runner is disabled",
      }),
    );

    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message .* \(Enter to send\)/), {
      target: { value: "ping" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(
        screen.getByText(/OpenCode chat runner is disabled/i),
      ).toBeInTheDocument();
    });
  });

  it("clears history when the selected agent changes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('data: {"text":"First agent reply"}\n\ndata: [DONE]\n\n'),
            );
            controller.close();
          },
        }),
      }),
    );

    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message .* \(Enter to send\)/), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByText("First agent reply")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "sophia" },
    });

    expect(screen.queryByText("First agent reply")).not.toBeInTheDocument();
    expect(screen.getByText(/Ask OpenClaw subagent - Sophia/i)).toBeInTheDocument();
  });

  it("labels MemroOS system agents when metadata is not from PMO", () => {
    mockUseAgents.mockReturnValue({
      data: {
        agents: [
          ...FIXTURE_AGENTS,
          {
            id: "memroos-ops",
            name: "Ops Agent",
            role: "Operator helper",
            company: null,
            platform: "codex",
            protocol: "local",
            metadata: { source: "registry" },
          },
        ],
      },
    } as ReturnType<typeof useAgents>);

    render(<VoicePanel />);
    expect(screen.getByRole("option", { name: "MemroOS system - Ops Agent" })).toBeInTheDocument();
  });

  it("shows thinking state while a chat request is in flight", async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending));

    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message .* \(Enter to send\)/), {
      target: { value: "slow" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(screen.getByText("…")).toBeInTheDocument();

    resolveFetch(
      new Response('data: {"text":"done"}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("done")).toBeInTheDocument();
    });
  });

  it("starts voice capture and sends the final transcript", async () => {
    class MockRecognition {
      continuous = false;
      interimResults = true;
      lang = "en-US";
      onresult: ((event: SpeechRecognitionEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        const result = {
          isFinal: true,
          0: { transcript: "voice hello" },
        } as unknown as SpeechRecognitionResult;
        const event = { results: [result] } as unknown as SpeechRecognitionEvent;
        this.onresult?.(event);
      }
      stop() {}
    }

    vi.stubGlobal("SpeechRecognition", MockRecognition);
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode('data: {"text":"Voice reply"}\n\ndata: [DONE]\n\n'),
              );
              controller.close();
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          blob: async () => new Blob(["audio"], { type: "audio/mpeg" }),
        }),
    );

    const play = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      "Audio",
      class {
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        play = play;
      },
    );
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:voice"),
      revokeObjectURL: vi.fn(),
    });

    render(<VoicePanel />);
    fireEvent.click(screen.getByRole("button", { name: "voice" }));
    fireEvent.click(screen.getByRole("button", { name: "Start listening" }));

    await waitFor(() => {
      expect(screen.getByText("Voice reply")).toBeInTheDocument();
    });
  });

  it("labels dedicated CLI agent ids and knowledge project paths", () => {
    mockUseAgents.mockReturnValue({
      data: {
        agents: [
          {
            id: "codex-cli-agent",
            name: "Codex Agent",
            role: "Codex CLI identity",
            company: null,
            platform: "codex",
            protocol: "local",
            metadata: { source: "registry", path: "/workspace/knowledge/notes" },
          },
        ],
      },
    } as ReturnType<typeof useAgents>);
    render(<VoicePanel />);
    expect(screen.getByRole("option", { name: "Codex CLI - Agent" })).toBeInTheDocument();
  });

  it("labels dedicated Gemini and Cursor CLI identities", () => {
    mockUseAgents.mockReturnValue({
      data: {
        agents: [
          {
            id: "gemini-senior-engineer",
            name: "Gemini Engineer",
            role: "Gemini CLI identity",
            company: null,
            platform: "gemini",
            protocol: "local",
            metadata: { source: "registry" },
          },
          {
            id: "cursor-ide-agent",
            name: "Cursor Agent",
            role: "Cursor IDE identity",
            company: null,
            platform: "cursor",
            protocol: "local",
            metadata: { source: "registry" },
          },
        ],
      },
    } as ReturnType<typeof useAgents>);
    render(<VoicePanel />);
    expect(screen.getByRole("option", { name: "Gemini CLI - Senior Engineer" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Cursor IDE - Agent" })).toBeInTheDocument();
  });

  it("surfaces generic chat errors from non-streaming failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "upstream exploded",
      }),
    );
    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message .* \(Enter to send\)/), {
      target: { value: "boom" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(screen.getByText(/upstream exploded/i)).toBeInTheDocument();
    });
  });
});
