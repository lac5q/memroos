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
      id: `local-b35b-${randomUUID().slice(0, 6)}`,
      name: "Local B35b",
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

describe("VoicePanel batch35b", () => {
  it("send() returns immediately while a prior request is still loading (275)", async () => {
    const encoder = new TextEncoder();
    let resolveStream: (() => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveStream = () =>
            resolve({
              ok: true,
              body: new ReadableStream({
                start(controller) {
                  controller.enqueue(encoder.encode('data: {"text":"slow-b35b"}\n\n'));
                  controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                  controller.close();
                },
              }),
            } as Response);
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), {
      target: { value: `first-${randomUUID().slice(0, 4)}` },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByPlaceholderText(/Message/i), {
      target: { value: `second-${randomUUID().slice(0, 4)}` },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveStream?.();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("send() ignores empty trim-only drafts (275)", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), { target: { value: "\n\t  \n" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("local protocol agent appears in the dropdown", () => {
    render(<VoicePanel />);
    expect(screen.getByRole("option", { name: /Local B35b/i })).toBeInTheDocument();
  });

  it("send uses localhost chat endpoint for local agents", async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      body: new ReadableStream({
        start(c) {
          c.enqueue(encoder.encode('data: {"text":"batch35b ok"}\n\n'));
          c.enqueue(encoder.encode("data: [DONE]\n\n"));
          c.close();
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), {
      target: { value: `hello b35b ${randomUUID().slice(0, 4)}` },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/api\/chat/);
  });
});
