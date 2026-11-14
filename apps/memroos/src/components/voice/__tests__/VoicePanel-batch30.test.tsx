/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

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
          id: `voice-b30-${randomUUID().slice(0, 8)}`,
          name: "Voice Batch30",
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

describe("VoicePanel batch30", () => {
  it("send() returns early when a chat request is already in flight (line 275)", async () => {
    let resolveChat: (v: Response) => void = () => {};
    const chatPromise = new Promise<Response>((resolve) => {
      resolveChat = resolve;
    });

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      if (String(input).includes("/api/chat")) return chatPromise;
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), { target: { value: "first batch30" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));

    await waitFor(() => expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/chat")).length).toBe(1));

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/Message/i), { target: { value: "second batch30" } });
      fireEvent.click(screen.getByRole("button", { name: /Send/i }));
    });

    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/chat")).length).toBe(1);

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"text":"done-b30"}\n\n'));
        controller.close();
      },
    });
    resolveChat({ ok: true, body: stream } as Response);
    await waitFor(() => expect(screen.getByText(/done-b30/)).toBeInTheDocument());
  });
});
