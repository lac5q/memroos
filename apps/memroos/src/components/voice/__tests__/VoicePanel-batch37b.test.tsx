/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

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
  mockAgents([
    {
      id: `b37b-${randomUUID().slice(0, 6)}`,
      name: "Voice B37b",
      role: "Operator",
      company: null,
      platform: "local",
      protocol: "local",
      metadata: {},
    },
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VoicePanel batch37b", () => {
  it("send() surfaces Error.message for failed chat (295)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("voice-b37b-chat-failed");
      }),
    );
    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), {
      target: { value: "trigger batch37b error" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));
    await waitFor(() => expect(screen.getByText(/voice-b37b-chat-failed/)).toBeInTheDocument());
  });

  it("send() is a no-op while loading (275)", async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn(() => fetchPromise);
    vi.stubGlobal("fetch", fetchMock);
    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), { target: { value: "first batch37b" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByPlaceholderText(/Message/i), { target: { value: "second batch37b" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch(new Response(JSON.stringify({ reply: "ok" }), { status: 200 }));
  });
});