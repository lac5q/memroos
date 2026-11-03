import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

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
    role: "Engineer",
    company: null,
    platform: "claude",
    protocol: "local",
    metadata: {},
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAgents.mockReturnValue({
    data: { agents: FIXTURE_AGENTS },
  } as ReturnType<typeof useAgents>);
});

describe("VoicePanel batch21", () => {
  it("pauses an in-flight audio element before starting a new TTS playback", async () => {
    const pause = vi.fn();
    let audioInstances: Array<{ pause: typeof pause; onended: (() => void) | null; play: () => Promise<void> }> = [];

    vi.stubGlobal(
      "Audio",
      class {
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        pause = pause;
        play = vi.fn().mockImplementation(async () => undefined);
        constructor() {
          audioInstances.push(this);
        }
      },
    );
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:batch21-voice"),
      revokeObjectURL: vi.fn(),
    });

    let ttsCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/api/chat")) {
          return {
            ok: true,
            body: new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('data: {"text":"Voice line"}\n\ndata: [DONE]\n\n'));
                controller.close();
              },
            }),
          };
        }
        if (url.includes("/api/tts")) {
          ttsCalls += 1;
          return { ok: true, blob: async () => new Blob([`audio-${ttsCalls}`], { type: "audio/mpeg" }) };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );

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
          0: { transcript: "hello" },
        } as unknown as SpeechRecognitionResult;
        this.onresult?.({ results: [result] } as SpeechRecognitionEvent);
      }
      stop() {}
    }
    vi.stubGlobal("SpeechRecognition", MockRecognition);

    render(<VoicePanel />);
    fireEvent.click(screen.getByRole("button", { name: "voice" }));
    fireEvent.click(screen.getByRole("button", { name: "Start listening" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Stop speaking" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Start listening" }));

    await waitFor(() => {
      expect(pause).toHaveBeenCalled();
    });
    expect(audioInstances.length).toBeGreaterThan(1);
  });
});
