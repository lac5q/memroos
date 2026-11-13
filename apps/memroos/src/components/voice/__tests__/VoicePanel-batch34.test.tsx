/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

window.HTMLElement.prototype.scrollIntoView = vi.fn();

vi.mock("@/lib/api-client", () => ({ useAgents: vi.fn() }));

import { VoicePanel } from "@/components/voice/VoicePanel";
import { useAgents } from "@/lib/api-client";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("VoicePanel batch34", () => {
  it("buildVoiceAgentOption covers PMO, runtime subagent, and CLI branches (branches 67-122)", () => {
    const suffix = randomUUID().slice(0, 8);
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [
          {
            id: `pmo-b34-${suffix}`,
            name: `PMO B34 ${suffix}`,
            role: "PM",
            company: null,
            platform: "paperclip",
            protocol: "local",
            metadata: { source: "pmo-agents", path: "/workspace/PMO/acme" },
          },
          {
            id: `hermes-b34-${suffix}`,
            name: `Hermes B34 ${suffix}`,
            role: "Runtime",
            company: null,
            platform: "hermes",
            protocol: "a2a",
            masterId: "master-b34",
            metadata: {},
          },
          {
            id: "qwen-engineer",
            name: "Qwen B34",
            role: "engineer",
            company: null,
            platform: "qwen",
            protocol: "local",
            metadata: { workspace: "Core" },
          },
          {
            id: "cursor-ide-agent",
            name: `Cursor B34 ${suffix}`,
            role: "IDE worker",
            company: null,
            platform: "cursor",
            protocol: "local",
            metadata: { path: "/workspace/knowledge/docs" },
          },
        ],
      },
    } as ReturnType<typeof useAgents>);

    render(<VoicePanel />);
    expect(screen.getByRole("option", { name: /PC \(PMO\) - PMO B34/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /hermes subagent/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Qwen CLI - Engineer/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Cursor IDE - Agent/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Cursor IDE - Agent/i })).toBeInTheDocument();
  });

  it("send() returns early when loading (stmt 275)", async () => {
    const suffix = randomUUID().slice(0, 8);
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [
          {
            id: `voice-b34-${suffix}`,
            name: "Voice B34",
            role: "Engineer",
            company: null,
            platform: "claude",
            protocol: "local",
            metadata: {},
          },
        ],
      },
    } as ReturnType<typeof useAgents>);

    const encoder = new TextEncoder();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await gate;
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"text":"late"}\n\n'));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return { ok: true, body: stream };
      }),
    );

    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), {
      target: { value: `first b34 ${suffix}` },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));
    fireEvent.change(screen.getByPlaceholderText(/Message/i), {
      target: { value: `second b34 ${suffix}` },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(screen.getByText(/late|first b34/)).toBeInTheDocument());
  });
});
