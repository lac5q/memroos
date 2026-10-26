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
  mockUseAgents.mockReturnValue({ data: { agents: [] } } as ReturnType<typeof useAgents>);
});

describe("VoicePanel batch15b coverage", () => {
  it("groups Paperclip PMO agents and knowledge workspace paths", () => {
    mockUseAgents.mockReturnValue({
      data: {
        agents: [
          {
            id: "pc-agent",
            name: "PC Agent",
            role: "Project worker",
            company: "Acme",
            platform: "codex",
            protocol: "rest",
            metadata: { source: "pmo-agents", project: "Launch" },
          },
          {
            id: "kb-agent",
            name: "KB Agent",
            role: "Research",
            company: null,
            platform: "codex",
            protocol: "rest",
            metadata: { path: "/github/knowledge/skills/demo" },
          },
        ],
      },
    } as ReturnType<typeof useAgents>);

    render(<VoicePanel />);
    expect(screen.getByRole("option", { name: /PC \(Launch\) - PC Agent/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /MemroOS system - KB Agent/i })).toBeInTheDocument();
  });

  it("maps rate-limit and OpenCode-disabled chat errors to friendly copy", async () => {
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
      vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          text: async () => '{"error":{"type":"rate_limit_error","message":"quota exceeded"}}',
        })
        .mockResolvedValueOnce({
          ok: false,
          text: async () => "OpenCode chat runner is disabled for this host",
        }),
    );

    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message .* \(Enter to send\)/), {
      target: { value: "first" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(screen.getByText(/Provider limit hit/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(/Message .* \(Enter to send\)/), {
      target: { value: "second" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(screen.getByText(/MEMROOS_ENABLE_OPENCODE=true/i)).toBeInTheDocument();
    });
  });

  it("collapses and expands the panel chrome", () => {
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

    render(<VoicePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    expect(screen.queryByPlaceholderText(/Message .* \(Enter to send\)/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByPlaceholderText(/Message .* \(Enter to send\)/)).toBeInTheDocument();
  });
});
