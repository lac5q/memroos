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
          id: "pmo-batch28",
          name: "PMO Batch28",
          role: "Operator",
          company: "Acme",
          platform: "memroos",
          protocol: "local",
          metadata: { path: "/workspace/PMO/runbooks" },
        },
        {
          id: "hermes-worker-b28",
          name: "Hermes Batch28",
          role: "Subagent",
          company: null,
          platform: "hermes",
          protocol: "local",
          metadata: { masterId: "manager-1" },
        },
      ],
    },
  } as ReturnType<typeof useAgents>);
});

describe("VoicePanel batch28", () => {
  it("labels PMO knowledge paths and runtime subagent groups", () => {
    render(<VoicePanel />);
    expect(screen.getByRole("option", { name: /MemroOS system - PMO Batch28/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Hermes subagent - Hermes Batch28/i })).toBeInTheDocument();
  });

  it("surfaces friendly chat errors when the stream returns an error payload", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      if (String(input).includes("/api/chat")) {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('data: {"error":"OpenCode chat runner is disabled"}\n\n'),
            );
            controller.close();
          },
        });
        return { ok: true, body: stream };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), { target: { value: "hello batch28" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));

    await waitFor(() =>
      expect(screen.getByText(/OpenCode chat runner is disabled/i)).toBeInTheDocument(),
    );
  });
});
