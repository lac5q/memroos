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
  vi.unstubAllGlobals();
  mockUseAgents.mockReturnValue({
    data: { agents: [] },
  } as ReturnType<typeof useAgents>);
});

describe("VoicePanel batch14b coverage", () => {
  it("classifies custom CLI role agents outside the fixed id set", () => {
    mockUseAgents.mockReturnValue({
      data: {
        agents: [
          {
            id: "custom-cli-bot",
            name: "Custom CLI Bot",
            role: "local cli runner",
            company: null,
            platform: "opencode",
            protocol: "local",
            metadata: { source: "registry" },
          },
        ],
      },
    } as ReturnType<typeof useAgents>);

    render(<VoicePanel />);
    expect(screen.getByRole("option", { name: /CLI - Custom CLI Bot/i })).toBeInTheDocument();
  });

  it("labels hermes runtime subagents without masterId", () => {
    mockUseAgents.mockReturnValue({
      data: {
        agents: [
          {
            id: "hermes-runtime",
            name: "Hermes Runtime",
            role: "Worker",
            company: null,
            platform: "hermes",
            protocol: "rest",
            metadata: { source: "registry" },
          },
        ],
      },
    } as ReturnType<typeof useAgents>);

    render(<VoicePanel />);
    expect(screen.getByRole("option", { name: "Hermes subagent - Hermes Runtime" })).toBeInTheDocument();
  });

  it("clears conversation history when the selected agent changes", async () => {
    mockUseAgents.mockReturnValue({
      data: {
        agents: [
          {
            id: "agent-a",
            name: "Agent A",
            role: "Ops",
            company: null,
            platform: "codex",
            protocol: "local",
            metadata: { source: "registry" },
          },
          {
            id: "agent-b",
            name: "Agent B",
            role: "Ops",
            company: null,
            platform: "claude",
            protocol: "local",
            metadata: { source: "registry" },
          },
        ],
      },
    } as ReturnType<typeof useAgents>);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"text":"hello batch14b"}\n\ndata: [DONE]\n\n'));
            controller.close();
          },
        }),
      }),
    );

    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message .* \(Enter to send\)/), {
      target: { value: "ping" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByText("hello batch14b")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "agent-b" } });
    expect(screen.getByText(/Ask .* what they're working on/)).toBeInTheDocument();
  });

  it("does not send on Shift+Enter in the chat textarea", () => {
    mockUseAgents.mockReturnValue({
      data: {
        agents: [
          {
            id: "solo",
            name: "Solo",
            role: "Ops",
            company: null,
            platform: "codex",
            protocol: "local",
            metadata: { source: "registry" },
          },
        ],
      },
    } as ReturnType<typeof useAgents>);

    vi.stubGlobal("fetch", vi.fn());
    render(<VoicePanel />);
    const textarea = screen.getByPlaceholderText(/Message .* \(Enter to send\)/);
    fireEvent.change(textarea, { target: { value: "multiline" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("parses nested JSON error payloads for chat failures", async () => {
    mockUseAgents.mockReturnValue({
      data: {
        agents: [
          {
            id: "solo",
            name: "Solo",
            role: "Ops",
            company: null,
            platform: "codex",
            protocol: "local",
            metadata: { source: "registry" },
          },
        ],
      },
    } as ReturnType<typeof useAgents>);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        text: async () =>
          'upstream noise {"error":{"type":"provider_error","message":"nested provider failure"}}',
      }),
    );

    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message .* \(Enter to send\)/), {
      target: { value: "fail" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByText(/nested provider failure/i)).toBeInTheDocument();
    });
  });

  it("shows voice-tab mic prompt for the selected agent label", () => {
    mockUseAgents.mockReturnValue({
      data: {
        agents: [
          {
            id: "voice-target",
            name: "Voice Target",
            role: "Ops",
            company: null,
            platform: "codex",
            protocol: "local",
            metadata: { source: "registry" },
          },
        ],
      },
    } as ReturnType<typeof useAgents>);

    render(<VoicePanel />);
    fireEvent.click(screen.getByRole("button", { name: "voice" }));
    expect(screen.getByText(/Tap mic to speak with MemroOS system - Voice Target/i)).toBeInTheDocument();
  });

  it("skips malformed SSE chunks while streaming assistant text", async () => {
    mockUseAgents.mockReturnValue({
      data: {
        agents: [
          {
            id: "solo",
            name: "Solo",
            role: "Ops",
            company: null,
            platform: "codex",
            protocol: "local",
            metadata: { source: "registry" },
          },
        ],
      },
    } as ReturnType<typeof useAgents>);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("data: not-json\n\n"));
            controller.enqueue(new TextEncoder().encode('data: {"text":"partial"}\n\ndata: [DONE]\n\n'));
            controller.close();
          },
        }),
      }),
    );

    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message .* \(Enter to send\)/), {
      target: { value: "stream" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByText("partial")).toBeInTheDocument();
    });
  });
});
