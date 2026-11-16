/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

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

describe("VoicePanel batch39d", () => {
  it("send() no-ops while loading (line 275)", async () => {
    const suffix = randomUUID().slice(0, 8);
    mockAgents([
      {
        id: `voice-b39d-${suffix}`,
        name: `Voice B39d ${suffix}`,
        role: "Operator",
        company: null,
        platform: "local",
        protocol: "local",
        metadata: {},
      },
    ]);

    let resolveChat: (value: Response) => void = () => {};
    const chatPending = new Promise<Response>((resolve) => {
      resolveChat = resolve;
    });

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      if (String(input).includes("/api/chat")) return chatPending;
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), { target: { value: `batch39d first ${suffix}` } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /Send/i })).toBeDisabled());

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/Message/i), { target: { value: `batch39d second ${suffix}` } });
      fireEvent.click(screen.getByRole("button", { name: /Send/i }));
    });

    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/chat")).length).toBe(1);

    resolveChat({
      ok: true,
      body: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"text":"b39d voice ok"}\n\n'));
          c.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          c.close();
        },
      }),
    } as Response);

    await waitFor(() => expect(screen.getByText(/b39d voice ok/)).toBeInTheDocument());
  });

  it("send() rejects whitespace-only input (line 275 trim guard)", () => {
    const suffix = randomUUID().slice(0, 8);
    mockAgents([
      {
        id: `voice-ws-b39d-${suffix}`,
        name: `Voice WS B39d ${suffix}`,
        role: "Operator",
        company: null,
        platform: "local",
        protocol: "local",
        metadata: {},
      },
    ]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), { target: { value: "  \t\n" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});