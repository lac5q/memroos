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
          id: "gemini-senior-engineer",
          name: "Gemini Batch27",
          role: "Senior CLI",
          company: "Acme Labs",
          platform: "gemini",
          protocol: "local",
          metadata: { path: "/workspace/knowledge/docs/runbook" },
        },
        {
          id: "cursor-ide-agent",
          name: "Cursor Batch27",
          role: "Cursor IDE worker",
          company: null,
          platform: "cursor",
          protocol: "local",
          metadata: {},
        },
        {
          id: "plain-batch27",
          name: "Plain Batch27",
          role: "Operator",
          company: "Fallback Co",
          platform: "memroos",
          protocol: "local",
          metadata: {},
        },
      ],
    },
  } as ReturnType<typeof useAgents>);
  URL.createObjectURL = vi.fn(() => "blob:voice-batch27");
  URL.revokeObjectURL = vi.fn();
});

describe("VoicePanel batch27", () => {
  it("labels knowledge-path, gemini CLI, and company fallback project groups", () => {
    render(<VoicePanel />);
    expect(screen.getByRole("option", { name: /Gemini CLI - Senior Engineer/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Cursor IDE - Agent/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /MemroOS system - Plain Batch27/i })).toBeInTheDocument();
  });

  it("ignores blank sends while loading and stops an active mic session on second click", async () => {
    class MockRecognition {
      continuous = false;
      interimResults = true;
      lang = "en-US";
      onresult: ((event: { results: Array<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start = vi.fn();
      stop = vi.fn(() => {
        this.onend?.();
      });
    }
    vi.stubGlobal("SpeechRecognition", MockRecognition);
    vi.stubGlobal("webkitSpeechRecognition", MockRecognition);
    window.speechSynthesis = { cancel: vi.fn() } as unknown as SpeechSynthesis;

    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);

    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));
    expect(fetchMock).not.toHaveBeenCalledWith("/api/chat", expect.anything());

    fireEvent.click(screen.getByRole("button", { name: "voice" }));
    fireEvent.click(screen.getByRole("button", { name: /Start listening/i }));
    expect(screen.getByRole("button", { name: /Stop listening/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Stop listening/i }));
    expect(screen.getByRole("button", { name: /Start listening/i })).toBeInTheDocument();
  });

  it("clears speaking state when the audio element fires onerror", async () => {
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
      interimResults = true;
      lang = "en-US";
      onresult: ((event: { results: Array<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        this.onresult?.({
          results: [{ isFinal: true, 0: { transcript: "voice batch27 mic prompt" } }],
        });
        this.onend?.();
      }
      stop = vi.fn();
    }
    vi.stubGlobal("SpeechRecognition", MockRecognition);
    vi.stubGlobal("webkitSpeechRecognition", MockRecognition);
    window.speechSynthesis = { cancel: vi.fn() } as unknown as SpeechSynthesis;

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/api/chat")) {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"text":"voice batch27 tts reply"}\n\n'));
            controller.close();
          },
        });
        return { ok: true, body: stream };
      }
      if (url.includes("/api/tts")) {
        return { ok: true, blob: async () => new Blob(["audio"]) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<VoicePanel />);
    fireEvent.click(screen.getByRole("button", { name: "voice" }));
    fireEvent.click(screen.getByRole("button", { name: /Start listening/i }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/tts", expect.objectContaining({ method: "POST" })),
    );
  });
});
