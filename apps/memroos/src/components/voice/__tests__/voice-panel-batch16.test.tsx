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
    id: "solo-batch16",
    name: "Solo Batch16",
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

describe("VoicePanel batch16", () => {
  it("labels PMO path agents and company fallbacks in the agent picker", () => {
    mockUseAgents.mockReturnValue({
      data: {
        agents: [
          soloAgent({
            id: "pmo-path",
            name: "PMO Path Agent",
            metadata: { source: "pmo-agents", path: "/github/PMO/agents/demo" },
            company: null,
          }),
          soloAgent({
            id: "company-only",
            name: "Company Agent",
            metadata: { source: "pmo-agents" },
            company: "WidgetCo",
          }),
        ],
      },
    } as ReturnType<typeof useAgents>);

    render(<VoicePanel />);
    expect(screen.getByRole("option", { name: /PC \(PMO\) - PMO Path Agent/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /PC \(WidgetCo\) - Company Agent/i })).toBeInTheDocument();
  });

  it("keeps raw provider text when chat error JSON is malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: false,
        text: async () => "502 {not-valid-json",
      }),
    );

    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message .* \(Enter to send\)/), {
      target: { value: "batch16 malformed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByText(/502 \{not-valid-json/)).toBeInTheDocument();
    });
  });

  it("surfaces stream errors returned inside SSE payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"error":"stream failed batch16"}\n\n'));
            controller.close();
          },
        }),
      }),
    );

    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message .* \(Enter to send\)/), {
      target: { value: "stream batch16" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByText(/stream failed batch16/)).toBeInTheDocument();
    });
  });

  it("runs voice tab mic → chat → TTS chain for final transcripts", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const play = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      "Audio",
      class {
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        pause = vi.fn();
        play = play;
      },
    );
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:batch16-voice"),
      revokeObjectURL: vi.fn(),
    });

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
          results: [
            { isFinal: false, 0: { transcript: "interim batch16" } },
            { isFinal: true, 0: { transcript: "final batch16 voice" } },
          ],
        });
        this.onend?.();
      }
      stop() {}
    }

    vi.stubGlobal("SpeechRecognition", MockRecognition as unknown as typeof SpeechRecognition);
    vi.stubGlobal("webkitSpeechRecognition", MockRecognition as unknown as typeof SpeechRecognition);

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode('data: {"text":"Voice tab reply batch16"}\n\ndata: [DONE]\n\n'),
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

    render(<VoicePanel />);
    fireEvent.click(screen.getByRole("button", { name: "voice" }));
    fireEvent.click(screen.getByRole("button", { name: "Start listening" }));

    await waitFor(() => {
      expect(screen.getByText("Voice tab reply batch16")).toBeInTheDocument();
      const ttsCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes("/api/tts"));
      expect(String(ttsCall?.[1]?.body)).toContain("Voice tab reply batch16");
      expect(String(ttsCall?.[1]?.body)).toContain("solo-batch16");
      expect(play).toHaveBeenCalled();
    });

    alertSpy.mockRestore();
  });

  it("alerts when speech recognition is unavailable on the voice tab", () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    render(<VoicePanel />);
    fireEvent.click(screen.getByRole("button", { name: "voice" }));
    fireEvent.click(screen.getByRole("button", { name: "Start listening" }));
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining("Speech recognition not supported"));
    alertSpy.mockRestore();
  });
});
