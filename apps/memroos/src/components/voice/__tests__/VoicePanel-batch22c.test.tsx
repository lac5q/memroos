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
          id: "voice-agent-batch22c",
          name: "Voice Agent",
          role: "Engineer",
          company: null,
          platform: "claude",
          protocol: "local",
          metadata: {},
        },
      ],
    },
  } as ReturnType<typeof useAgents>);
  URL.createObjectURL = vi.fn(() => "blob:voice-batch22c");
  URL.revokeObjectURL = vi.fn();
});

describe("VoicePanel batch22c", () => {
  it("surfaces non-OK chat responses in the thread", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        if (String(input).includes("/api/chat")) {
          return { ok: false, status: 503, text: async () => "chat down batch22c" };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );

    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), { target: { value: "ping batch22c" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));

    await waitFor(() => {
      expect(screen.getByText(/503 chat down batch22c/i)).toBeInTheDocument();
    });
  });

  it("switches to voice tab and warns when speech recognition is unavailable", () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    render(<VoicePanel />);
    fireEvent.click(screen.getByRole("button", { name: /^voice$/i }));
    fireEvent.click(screen.getByRole("button", { name: /Start listening/i }));
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining("Speech recognition"));
    alertSpy.mockRestore();
  });
});
