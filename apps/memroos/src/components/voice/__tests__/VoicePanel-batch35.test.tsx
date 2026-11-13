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
      id: `voice-b35-${randomUUID().slice(0, 6)}`,
      name: "Voice B35",
      role: "Engineer",
      company: null,
      platform: "claude",
      protocol: "local",
      metadata: {},
    },
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VoicePanel batch35", () => {
  it("send() rejects whitespace-only messages (stmt 275)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("friendlyChatError surfaces rate-limit and OpenCode-disabled copy from HTTP errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 429,
        text: async () =>
          '{"error":{"message":"usage limit exceeded for batch35"}}',
      })),
    );
    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), {
      target: { value: `rate b35 ${randomUUID().slice(0, 4)}` },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));
    await waitFor(() =>
      expect(screen.getByText(/Provider limit hit|usage limit exceeded/i)).toBeInTheDocument(),
    );
  });

  it("streamChat maps inline SSE errors through friendlyChatError", async () => {
    const encoder = new TextEncoder();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode('data: {"error":"OpenCode chat runner is disabled"}\n\n'),
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        }),
      })),
    );
    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), {
      target: { value: `opencode b35 ${randomUUID().slice(0, 4)}` },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));
    await waitFor(() =>
      expect(screen.getByText(/MEMROOS_ENABLE_OPENCODE|OpenCode chat runner is disabled/i)).toBeInTheDocument(),
    );
  });

  it("buildVoiceAgentOption covers openclaw, knowledge path, and MemroOS system arms", () => {
    const suffix = randomUUID().slice(0, 8);
    mockAgents([
      {
        id: `openclaw-b35-${suffix}`,
        name: `OpenClaw B35 ${suffix}`,
        role: "Worker",
        company: null,
        platform: "openclaw",
        protocol: "a2a",
        metadata: {},
      },
      {
        id: `know-b35-${suffix}`,
        name: `Knowledge B35 ${suffix}`,
        role: "Librarian",
        company: "Acme",
        platform: "local",
        protocol: "local",
        metadata: { path: "/workspace/knowledge/docs", source: "agents" },
      },
      {
        id: `gemini-senior-engineer`,
        name: "Gemini B35",
        role: "Senior",
        company: null,
        platform: "gemini",
        protocol: "local",
        metadata: {},
      },
    ]);
    render(<VoicePanel />);
    expect(screen.getByRole("option", { name: /openclaw subagent/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Gemini CLI - Senior Engineer/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /MemroOS system - Knowledge B35/i })).toBeInTheDocument();
  });

  it("Shift+Enter keeps draft; collapse hides transcript controls", async () => {
    const encoder = new TextEncoder();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        body: new ReadableStream({
          start(c) {
            c.enqueue(encoder.encode('data: {"text":"ok"}\n\n'));
            c.enqueue(encoder.encode("data: [DONE]\n\n"));
            c.close();
          },
        }),
      })),
    );
    render(<VoicePanel />);
    const area = screen.getByPlaceholderText(/Message/i);
    fireEvent.change(area, { target: { value: "line1" } });
    fireEvent.keyDown(area, { key: "Enter", shiftKey: true });
    expect(area).toHaveValue("line1");
    fireEvent.click(screen.getByRole("button", { name: /Collapse/i }));
    expect(screen.queryByPlaceholderText(/Message/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Expand/i }));
    expect(screen.getByPlaceholderText(/Message/i)).toBeInTheDocument();
  });

  it("voice tab alerts when SpeechRecognition is unavailable", () => {
    const alertMock = vi.spyOn(window, "alert").mockImplementation(() => {});
    render(<VoicePanel />);
    fireEvent.click(screen.getByRole("button", { name: /^chat$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^voice$/i }));
    fireEvent.click(screen.getByLabelText(/Start listening/i));
    expect(alertMock).toHaveBeenCalledWith(expect.stringMatching(/Speech recognition not supported/i));
    alertMock.mockRestore();
  });
});
