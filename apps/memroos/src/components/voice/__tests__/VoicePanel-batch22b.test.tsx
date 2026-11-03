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
          id: "voice-agent-batch22b",
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
});

describe("VoicePanel batch22b", () => {
  it("streams assistant text when chat succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        if (String(input).includes("/api/chat")) {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"text":"batch22b voice ok"}\n\n'));
              controller.close();
            },
          });
          return { ok: true, body: stream };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );

    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), { target: { value: "hello batch22b" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));

    await waitFor(() => {
      expect(screen.getByText(/batch22b voice ok/i)).toBeInTheDocument();
    });
  });
});
