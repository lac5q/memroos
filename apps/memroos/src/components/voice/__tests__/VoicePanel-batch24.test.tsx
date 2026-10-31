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
          id: "voice-batch24",
          name: "Voice Batch24",
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

describe("VoicePanel batch24", () => {
  it("surfaces chat HTTP failures with friendly detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        if (String(input).includes("/api/chat")) {
          return { ok: false, status: 502, text: async () => '{"error":{"message":"voice batch24 down"}}' };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );

    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), { target: { value: "hello batch24" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));

    await waitFor(() => expect(screen.getByText(/voice batch24 down/i)).toBeInTheDocument());
  });

  it("ignores empty sends while loading", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    render(<VoicePanel />);
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));
    expect(fetch).not.toHaveBeenCalled();
  });
});
