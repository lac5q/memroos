/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

window.HTMLElement.prototype.scrollIntoView = vi.fn();

vi.mock("@/lib/api-client", () => ({ useAgents: vi.fn() }));

import { VoicePanel } from "@/components/voice/VoicePanel";
import { useAgents } from "@/lib/api-client";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAgents).mockReturnValue({
    data: {
      agents: [
        {
          id: "codex-cli-agent",
          name: "Codex Batch25",
          role: "Engineer CLI",
          company: "Acme",
          platform: "codex",
          protocol: "local",
          metadata: { path: "/workspace/PMO/project-a" },
        },
        {
          id: "hermes-sub-batch25",
          name: "Hermes Sub",
          role: "Worker",
          company: null,
          platform: "hermes",
          protocol: "local",
          masterId: "parent-batch25",
          metadata: {},
        },
        {
          id: "pmo-batch25",
          name: "PMO Batch25",
          role: "Planner",
          company: null,
          platform: "claude",
          protocol: "local",
          metadata: { source: "pmo-agents", project: "Ops" },
        },
        {
          id: "memroos-batch25",
          name: "MemroOS Batch25",
          role: "Operator",
          company: null,
          platform: "memroos",
          protocol: "local",
          metadata: { workspace: "core" },
        },
      ],
    },
  } as ReturnType<typeof useAgents>);
  URL.createObjectURL = vi.fn(() => "blob:voice-batch25");
  URL.revokeObjectURL = vi.fn();
});

describe("VoicePanel batch25", () => {
  it("groups CLI, runtime subagent, and paperclip agents in the selector", () => {
    render(<VoicePanel />);
    expect(screen.getByRole("option", { name: /Codex CLI - Agent/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Hermes subagent - Hermes Sub/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /PC \(Ops\) - PMO Batch25/i })).toBeInTheDocument();
  });

  it("maps provider limit and OpenCode disabled chat errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        if (String(input).includes("/api/chat")) {
          return {
            ok: false,
            status: 429,
            text: async () =>
              '{"error":{"type":"rate_limit_error","message":"batch25 quota"}} OpenCode chat runner is disabled',
          };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );

    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), { target: { value: "limit batch25" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));

    await waitFor(() =>
      expect(screen.getByText(/Provider limit hit:.*batch25 quota/i)).toBeInTheDocument(),
    );
  });

  it("surfaces inline stream errors and collapses the panel chrome", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        if (String(input).includes("/api/chat")) {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"error":"stream batch25 fault"}\n\n'));
              controller.close();
            },
          });
          return { ok: true, body: stream };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );

    render(<VoicePanel />);
    fireEvent.click(screen.getByRole("button", { name: /Collapse/i }));
    expect(screen.queryByPlaceholderText(/Message/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Expand/i }));
    fireEvent.change(screen.getByPlaceholderText(/Message/i), { target: { value: "stream batch25" } });
    fireEvent.keyDown(screen.getByPlaceholderText(/Message/i), { key: "Enter", shiftKey: true });
    expect(fetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Send/i }));
    await waitFor(() => expect(screen.getByText(/stream batch25 fault/i)).toBeInTheDocument());
  });

  it("clears speaking state when TTS playback fails", async () => {
    class FailAudio {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      pause = vi.fn();
      play = vi.fn().mockRejectedValue(new Error("play failed batch25"));
    }
    vi.stubGlobal("Audio", FailAudio);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/api/chat")) {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"text":"tts batch25"}\n\n'));
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

    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), { target: { value: "speak batch25" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));

    await waitFor(() => expect(screen.getByText("tts batch25")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^voice$/i }));
    expect(screen.getByText(/Tap mic to speak/i)).toBeInTheDocument();
  });
});
