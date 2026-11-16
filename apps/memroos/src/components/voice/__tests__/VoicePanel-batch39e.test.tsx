/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

window.HTMLElement.prototype.scrollIntoView = vi.fn();

vi.mock("@/lib/api-client", () => ({ useAgents: vi.fn() }));

import { VoicePanel } from "@/components/voice/VoicePanel";
import { useAgents } from "@/lib/api-client";

function mockAgents(agents: NonNullable<ReturnType<typeof useAgents>["data"]>["agents"]) {
  vi.mocked(useAgents).mockReturnValue({
    data: { agents },
  } as ReturnType<typeof useAgents>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VoicePanel batch39e — send early return via speech", () => {
  it("speech final whitespace transcript hits send trim guard (275)", async () => {
    const suffix = randomUUID().slice(0, 8);
    mockAgents([
      {
        id: `voice-b39e-${suffix}`,
        name: `Voice B39e ${suffix}`,
        role: "Operator",
        company: null,
        platform: "local",
        protocol: "local",
        metadata: {},
      },
    ]);

    const fetchMock = vi.fn(async () => ({
      ok: true,
      body: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          c.close();
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    type ResultHandler = ((event: {
      results: Array<{ 0: { transcript: string }; isFinal: boolean; length: number }>;
    }) => void) | null;

    let onresult: ResultHandler = null;
    let onend: (() => void) | null = null;

    class FakeSpeechRecognition {
      continuous = false;
      interimResults = false;
      lang = "en-US";
      set onresult(handler: ResultHandler) {
        onresult = handler;
      }
      get onresult() {
        return onresult;
      }
      set onend(handler: (() => void) | null) {
        onend = handler;
      }
      get onend() {
        return onend;
      }
      onerror: ((event: unknown) => void) | null = null;
      start() {
        queueMicrotask(() => {
          // isFinal must be true or VoicePanel never calls send().
          // Whitespace-only transcript then hits !msg.trim() at line 275.
          onresult?.({
            results: [
              {
                0: { transcript: "   \t  " },
                isFinal: true,
                length: 1,
              },
            ],
          });
          onend?.();
        });
      }
      stop() {}
      abort() {}
    }

    vi.stubGlobal("SpeechRecognition", FakeSpeechRecognition);
    vi.stubGlobal("webkitSpeechRecognition", FakeSpeechRecognition);
    vi.stubGlobal("speechSynthesis", { cancel: vi.fn() });

    render(<VoicePanel />);
    fireEvent.click(screen.getByRole("button", { name: /^voice$/i }));
    const micButton =
      screen.getAllByRole("button").find((btn) => btn.className.includes("rounded-full")) ?? null;
    expect(micButton).toBeTruthy();

    await act(async () => {
      fireEvent.click(micButton!);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/chat")).length).toBe(0);
  });
});
