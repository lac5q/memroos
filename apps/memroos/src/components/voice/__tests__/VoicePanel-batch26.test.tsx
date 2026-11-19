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
          id: "qwen-engineer",
          name: "Qwen Batch26",
          role: "Engineer CLI",
          company: "Acme Corp",
          platform: "qwen",
          protocol: "local",
          metadata: { path: "/workspace/knowledge/docs" },
        },
        {
          id: "hermes-sub-batch26",
          name: "Hermes Batch26",
          role: "Worker",
          company: null,
          platform: "hermes",
          protocol: "local",
          masterId: "parent-batch26",
          metadata: {},
        },
        {
          id: "voice-batch26",
          name: "Voice Batch26",
          role: "Operator",
          company: null,
          platform: "claude",
          protocol: "local",
          metadata: {},
        },
      ],
    },
  } as ReturnType<typeof useAgents>);
  URL.createObjectURL = vi.fn(() => "blob:voice-batch26");
  URL.revokeObjectURL = vi.fn();
});

describe("VoicePanel batch26", () => {
  it("groups CLI knowledge-path and runtime subagent options", () => {
    render(<VoicePanel />);
    expect(screen.getByRole("option", { name: /Qwen CLI - Engineer/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Hermes subagent - Hermes Batch26/i })).toBeInTheDocument();
  });

  it("maps chat HTTP failures without a readable body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        if (String(input).includes("/api/chat")) {
          return {
            ok: false,
            status: 502,
            text: async () => {
              throw new Error("voice batch26 body down");
            },
          };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );

    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), { target: { value: "hello batch26" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));

    await waitFor(() => expect(screen.getByText(/502/i)).toBeInTheDocument());
  });

  it("sends on Enter and completes voice tab mic flow with TTS playback", async () => {
    class OkAudio {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      pause = vi.fn();
      play = vi.fn().mockImplementation(async () => {
        this.onended?.();
      });
    }
    vi.stubGlobal("Audio", OkAudio);

    class MockRecognition {
      continuous = false;
      interimResults = false;
      lang = "en-US";
      onresult: ((event: { results: Array<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        this.onresult?.({
          results: [{ isFinal: false, 0: { transcript: "hearing batch26" } }, { isFinal: true, 0: { transcript: "final batch26 prompt" } }],
        });
        this.onend?.();
      }
      stop() {
        this.onend?.();
      }
    }
    vi.stubGlobal("SpeechRecognition", MockRecognition);
    vi.stubGlobal("webkitSpeechRecognition", MockRecognition);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/api/chat")) {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"text":"voice batch26 reply"}\n\n'));
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
    fireEvent.change(screen.getByPlaceholderText(/Message/i), { target: { value: "enter batch26" } });
    fireEvent.keyDown(screen.getByPlaceholderText(/Message/i), { key: "Enter", shiftKey: false });
    await waitFor(() => expect(screen.getByText("voice batch26 reply")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "voice" }));
    fireEvent.click(screen.getByRole("button", { name: /Start listening/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/tts", expect.objectContaining({ method: "POST" })));
  });

  it("alerts when speech recognition is unavailable", () => {
    vi.stubGlobal("SpeechRecognition", undefined);
    vi.stubGlobal("webkitSpeechRecognition", undefined);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    render(<VoicePanel />);
    fireEvent.click(screen.getByRole("button", { name: "voice" }));
    fireEvent.click(screen.getByRole("button", { name: /Start listening/i }));

    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining("Speech recognition not supported"));
    alertSpy.mockRestore();
  });
});
