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
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VoicePanel batch38", () => {
  it("streamChat surfaces bare HTTP status when error body is empty (197–199)", async () => {
    mockAgents([
      {
        id: `b38-http-${randomUUID().slice(0, 6)}`,
        name: "Voice B38",
        role: "Operator",
        company: null,
        platform: "local",
        protocol: "local",
        metadata: {},
      },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 502,
        body: null,
        text: async () => "",
      })),
    );
    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), { target: { value: "batch38 bare http" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));
    await waitFor(() => expect(screen.getByText(/⚠ HTTP 502/)).toBeInTheDocument());
  });

  it("friendlyChatError keeps raw text when embedded JSON is invalid (132–140)", async () => {
    mockAgents([
      {
        id: `b38-json-${randomUUID().slice(0, 6)}`,
        name: "Voice B38 JSON",
        role: "Operator",
        company: null,
        platform: "local",
        protocol: "local",
        metadata: {},
      },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        body: { getReader: () => ({}) },
        text: async () => "prefix {not-valid-json",
      })),
    );
    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), { target: { value: "batch38 bad json" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));
    await waitFor(() => expect(screen.getByText(/prefix \{not-valid-json/)).toBeInTheDocument());
  });

  it("streamChat ignores malformed SSE lines but still appends valid chunks (219)", async () => {
    mockAgents([
      {
        id: `b38-sse-${randomUUID().slice(0, 6)}`,
        name: "Voice B38 SSE",
        role: "Operator",
        company: null,
        platform: "local",
        protocol: "local",
        metadata: {},
      },
    ]);
    const encoder = new TextEncoder();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode("data: {broken\n\n"));
            controller.enqueue(encoder.encode('data: {"text":"sse-ok-b38"}\n\n'));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        }),
      })),
    );
    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), { target: { value: "batch38 sse" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));
    await waitFor(() => expect(screen.getByText("sse-ok-b38")).toBeInTheDocument());
  });

  it("changing the agent select clears shared history (402)", async () => {
    const suffix = randomUUID().slice(0, 8);
    const a = `agent-a-${suffix}`;
    const b = `agent-b-${suffix}`;
    mockAgents([
      {
        id: a,
        name: `Agent A ${suffix}`,
        role: "One",
        company: null,
        platform: "local",
        protocol: "local",
        metadata: {},
      },
      {
        id: b,
        name: `Agent B ${suffix}`,
        role: "Two",
        company: null,
        platform: "local",
        protocol: "local",
        metadata: {},
      },
    ]);
    const encoder = new TextEncoder();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        body: new ReadableStream({
          start(c) {
            c.enqueue(encoder.encode('data: {"text":"history marker b38"}\n\n'));
            c.enqueue(encoder.encode("data: [DONE]\n\n"));
            c.close();
          },
        }),
      })),
    );
    render(<VoicePanel />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), { target: { value: "leave trace" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));
    await waitFor(() => expect(screen.getByText("history marker b38")).toBeInTheDocument());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: b } });
    expect(screen.queryByText("history marker b38")).not.toBeInTheDocument();
    expect(screen.getByText(/Ask MemroOS system - Agent B/i)).toBeInTheDocument();
  });

  it("voice tab empty placeholder differs from chat (459–461)", () => {
    mockAgents([
      {
        id: `b38-voice-${randomUUID().slice(0, 6)}`,
        name: "Voice Tab B38",
        role: "Guide",
        company: null,
        platform: "local",
        protocol: "local",
        metadata: {},
      },
    ]);
    render(<VoicePanel />);
    expect(screen.getByText(/Ask MemroOS system - Voice Tab B38 what they're working on/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^voice$/i }));
    expect(screen.getByText(/Tap the mic and speak to MemroOS system - Voice Tab B38/i)).toBeInTheDocument();
  });

  it("buildVoiceAgentOption uses custom CLI label and company project fallback (67, 85)", () => {
    const suffix = randomUUID().slice(0, 8);
    mockAgents([
      {
        id: `custom-cli-${suffix}`,
        name: `Custom CLI ${suffix}`,
        role: " senior cli runner ",
        company: "Batch38Co",
        platform: "mystery",
        protocol: "local",
        metadata: { source: "agents" },
      },
    ]);
    render(<VoicePanel />);
    expect(screen.getByRole("option", { name: /Mystery CLI - Custom CLI/i })).toBeInTheDocument();
  });
});