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
          id: "voice-batch23",
          name: "Voice Batch23",
          role: "Engineer",
          company: null,
          platform: "claude",
          protocol: "local",
          metadata: {},
        },
      ],
    },
  } as ReturnType<typeof useAgents>);
  URL.createObjectURL = vi.fn(() => "blob:voice-batch23");
  URL.revokeObjectURL = vi.fn();
});

describe("VoicePanel batch23", () => {
  it("sends chat on Enter and completes a successful stream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        if (String(input).includes("/api/chat")) {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"text":"batch23 ok"}\n\n'));
              controller.close();
            },
          });
          return { ok: true, body: stream };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );

    render(<VoicePanel />);
    const input = screen.getByPlaceholderText(/Message/i);
    fireEvent.change(input, { target: { value: "hello batch23" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    await waitFor(() => expect(screen.getByText("batch23 ok")).toBeInTheDocument());
  });

  it("handles voice recognition final transcripts with TTS playback", async () => {
    class VoiceAudio {
      onended: (() => void) | null = null;
      pause = vi.fn();
      play = vi.fn().mockImplementation(async () => {
        this.onended?.();
      });
    }
    vi.stubGlobal("Audio", VoiceAudio);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/api/chat")) {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"text":"voice batch23"}\n\n'));
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

    const SR = vi.fn().mockImplementation(function SR(this: {
      onresult: ((ev: SpeechRecognitionEvent) => void) | null;
      start: () => void;
      stop: () => void;
    }) {
      this.stop = vi.fn();
      this.start = () => {
        const result = { isFinal: true, 0: { transcript: "speak batch23" }, length: 1 };
        const results = [result] as unknown as SpeechRecognitionResultList;
        this.onresult?.({ resultIndex: 0, results } as SpeechRecognitionEvent);
      };
    });
    vi.stubGlobal("SpeechRecognition", SR);
    vi.stubGlobal("webkitSpeechRecognition", SR);

    render(<VoicePanel />);
    fireEvent.click(screen.getByRole("button", { name: /^voice$/i }));
    fireEvent.click(screen.getByRole("button", { name: /Start listening/i }));

    await waitFor(() => expect(screen.getByText("voice batch23")).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith("/api/tts", expect.objectContaining({ method: "POST" }));
  });
});
