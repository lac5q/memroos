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

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAgents.mockReturnValue({
    data: {
      agents: [
        {
          id: "claude-sonnet-engineer",
          name: "Claude Sonnet Engineer",
          role: "Engineer",
          company: null,
          platform: "claude",
          protocol: "local",
          metadata: {},
        },
      ],
    },
  } as ReturnType<typeof useAgents>);
});

describe("VoicePanel batch22", () => {
  it("throws friendly chat errors when the stream response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input: RequestInfo) => {
        if (String(input).includes("/api/chat")) {
          return {
            ok: false,
            status: 503,
            text: async () => '{"error":"batch22 voice chat failed"}',
          };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );

    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), { target: { value: "ping" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));

    await waitFor(() => {
      expect(screen.getByText(/batch22 voice chat failed|503/i)).toBeInTheDocument();
    });
  });

  it("alerts when speech recognition is unavailable", () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    // @ts-expect-error test cleanup
    delete window.SpeechRecognition;
    // @ts-expect-error test cleanup
    delete window.webkitSpeechRecognition;

    render(<VoicePanel />);
    fireEvent.click(screen.getByRole("button", { name: "voice" }));
    fireEvent.click(screen.getByRole("button", { name: "Start listening" }));

    expect(alertSpy).toHaveBeenCalledWith(
      expect.stringContaining("Speech recognition not supported"),
    );
    alertSpy.mockRestore();
  });
});
