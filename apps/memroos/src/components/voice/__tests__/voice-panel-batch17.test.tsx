/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

window.HTMLElement.prototype.scrollIntoView = vi.fn();

vi.mock("@/lib/api-client", () => ({
  useAgents: vi.fn(),
}));

import { VoicePanel } from "@/components/voice/VoicePanel";
import { useAgents } from "@/lib/api-client";

const mockUseAgents = vi.mocked(useAgents);

function soloAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: "solo-batch17",
    name: "Solo Batch17",
    role: "Ops",
    company: "Acme Corp",
    platform: "codex",
    protocol: "local",
    metadata: { source: "registry" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mockUseAgents.mockReturnValue({ data: { agents: [soloAgent()] } } as ReturnType<typeof useAgents>);
});

describe("VoicePanel batch17", () => {
  it("ignores blank send attempts while idle", async () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<VoicePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("surfaces HTTP chat failures when the response has no stream body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 502,
        body: null,
        text: async () => "batch17 gateway unavailable",
      }),
    );

    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message .* \(Enter to send\)/), {
      target: { value: "batch17 no body" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByText(/batch17 gateway unavailable/)).toBeInTheDocument();
    });
  });

  it("recovers from TTS failures after a successful chat reply on the voice tab", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"text":"Batch17 voice reply"}\n\ndata: [DONE]\n\n'));
              controller.close();
            },
          }),
        })
        .mockResolvedValueOnce({ ok: false, status: 503, blob: async () => new Blob([]) }),
    );

    class MockRecognition {
      continuous = false;
      interimResults = true;
      lang = "en-US";
      onresult:
        | ((event: {
            results: Array<{ isFinal: boolean; 0: { transcript: string } }>;
          }) => void)
        | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        this.onresult?.({
          results: [{ isFinal: true, 0: { transcript: "batch17 voice tts fail" } }],
        });
        this.onend?.();
      }
      stop() {}
    }
    vi.stubGlobal("SpeechRecognition", MockRecognition as unknown as typeof SpeechRecognition);
    vi.stubGlobal("webkitSpeechRecognition", MockRecognition as unknown as typeof SpeechRecognition);

    render(<VoicePanel />);
    fireEvent.click(screen.getByRole("button", { name: "voice" }));
    fireEvent.click(screen.getByRole("button", { name: "Start listening" }));

    await waitFor(() => {
      expect(screen.getByText("Batch17 voice reply")).toBeInTheDocument();
      expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/api/tts"))).toBe(true);
    });
  });

  it("stops listening when speech recognition errors", () => {
    class MockRecognition {
      continuous = false;
      interimResults = true;
      lang = "en-US";
      onresult: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        this.onerror?.();
      }
      stop() {}
    }
    vi.stubGlobal("SpeechRecognition", MockRecognition as unknown as typeof SpeechRecognition);
    vi.stubGlobal("webkitSpeechRecognition", MockRecognition as unknown as typeof SpeechRecognition);

    render(<VoicePanel />);
    fireEvent.click(screen.getByRole("button", { name: "voice" }));
    fireEvent.click(screen.getByRole("button", { name: "Start listening" }));
    expect(screen.getByRole("button", { name: "Start listening" })).toBeInTheDocument();
  });
});
