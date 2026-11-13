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
      id: `b36b-${randomUUID().slice(0, 6)}`,
      name: "Voice B36b",
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

describe("VoicePanel batch36b", () => {
  it("send() surfaces stream errors in assistant history (294–300)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(`voice-b36b-${randomUUID().slice(0, 4)}`);
      }),
    );
    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), {
      target: { value: "trigger b36b error" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));
    await waitFor(() => expect(screen.getByText(/⚠/)).toBeInTheDocument());
  });

  it("Shift+Enter does not send while Enter submits", async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      body: new ReadableStream({
        start(c) {
          c.enqueue(encoder.encode('data: {"text":"batch36b ok"}\n\n'));
          c.enqueue(encoder.encode("data: [DONE]\n\n"));
          c.close();
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<VoicePanel />);
    const area = screen.getByPlaceholderText(/Message/i);
    fireEvent.change(area, { target: { value: "line one" } });
    fireEvent.keyDown(area, { key: "Enter", shiftKey: true });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.keyDown(area, { key: "Enter", shiftKey: false });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it("collapse hides conversation chrome until expanded", () => {
    render(<VoicePanel />);
    expect(screen.getByPlaceholderText(/Message/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Collapse/i }));
    expect(screen.queryByPlaceholderText(/Message/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Expand/i }));
    expect(screen.getByPlaceholderText(/Message/i)).toBeInTheDocument();
  });

  it("voice tab shows mic prompt copy for selected agent", () => {
    render(<VoicePanel />);
    fireEvent.click(screen.getByRole("button", { name: /^voice$/i }));
    expect(screen.getByText(/Tap mic to speak with MemroOS system - Voice B36b/i)).toBeInTheDocument();
  });
});
