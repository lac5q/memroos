/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/components/dispatch/lineage-drawer", () => ({
  LineageDrawer: () => null,
}));

vi.mock("@/lib/api-client", () => ({
  useAgents: vi.fn(),
  useDelegations: vi.fn(() => ({
    data: { delegations: [] },
    isLoading: false,
  })),
}));

import { useAgents } from "@/lib/api-client";
import { AgentEngagementConsole } from "../agent-engagement-console";

const rosterAgent = (overrides: Record<string, unknown>) => ({
  id: "custom-directory-agent",
  name: "Custom Directory",
  role: "Support",
  platform: "codex",
  protocol: "local",
  status: "idle",
  lastHeartbeat: null,
  currentTask: null,
  lessonsCount: 0,
  todayMemoryCount: 0,
  location: "local",
  isRemote: false,
  latencyMs: null,
  capabilities: [],
  metadata: {},
  host: null,
  port: null,
  healthEndpoint: null,
  tunnelUrl: null,
  createdAt: "2026-05-11T00:00:00Z",
  updatedAt: "2026-05-11T00:00:00Z",
  deregisteredAt: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

describe("AgentEngagementConsole batch17", () => {
  it("sorts common roster agents ahead of directory-only agents", () => {
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [
          rosterAgent({ id: "custom-directory-agent", name: "ZZ Directory", status: "active" }),
          rosterAgent({ id: "claude-sonnet-engineer", name: "Claude Sonnet Engineer", platform: "claude", status: "active" }),
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    render(<AgentEngagementConsole />);
    const names = screen.getAllByText(/Claude Sonnet Engineer|ZZ Directory/);
    expect(names[0].textContent).toContain("Claude Sonnet Engineer");
  });

  it("surfaces non-JSON chat HTTP failures in the assistant transcript", async () => {
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [rosterAgent({ id: "claude-sonnet-engineer", name: "Claude Sonnet Engineer", platform: "claude", status: "active" })],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 503,
      body: null,
      text: async () => "plain batch17 outage text",
    } as Response);

    render(<AgentEngagementConsole />);
    fireEvent.change(screen.getByLabelText("Direct message"), { target: { value: "batch17 http fail" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(screen.getByText(/plain batch17 outage text/)).toBeInTheDocument();
    });
  });

  it("runs default roster agent tests from Test primary agents", async () => {
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [
          rosterAgent({ id: "claude-sonnet-engineer", name: "Claude Sonnet Engineer", platform: "claude", status: "active" }),
          rosterAgent({ id: "codex-cli-agent", name: "Codex CLI", status: "active" }),
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            agentId: "claude-sonnet-engineer",
            name: "Claude Sonnet Engineer",
            status: "active",
            chat: { status: "ready", runner: "claude", detail: "ok" },
            dispatch: { status: "ready", adapter: "rest", detail: "ok" },
            voice: { status: "ready", detail: "ok" },
          },
        ],
      }),
    } as Response);

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: "Test primary agents" }));

    await waitFor(() => {
      const [, init] = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(String(init?.body)) as { agentIds: string[] };
      expect(body.agentIds).toContain("claude-sonnet-engineer");
      expect(body.agentIds).toContain("codex-cli-agent");
    });
  });

  it("clears speaking state when TTS playback fails", async () => {
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [rosterAgent({ id: "claude-sonnet-engineer", name: "Claude Sonnet Engineer", platform: "claude", status: "active" })],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    vi.stubGlobal(
      "Audio",
      class {
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        pause = vi.fn();
        play = vi.fn().mockRejectedValue(new Error("batch17 audio blocked"));
      },
    );
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:batch17-tts-fail"),
      revokeObjectURL: vi.fn(),
    });

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response('data: {"text":"Batch17 voice reply"}\n\ndata: [DONE]\n\n', {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      )
      .mockResolvedValueOnce({
        ok: true,
        blob: async () => new Blob(["audio"], { type: "audio/mpeg" }),
      } as Response);

    class MockRecognition {
      continuous = false;
      interimResults = false;
      lang = "en-US";
      onresult: ((event: { results: Array<{ 0: { transcript: string } }> }) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        this.onresult?.({ results: [{ 0: { transcript: "batch17 speak fail" } }] });
        this.onend?.();
      }
      stop() {}
    }
    vi.stubGlobal("SpeechRecognition", MockRecognition as unknown as typeof SpeechRecognition);
    vi.stubGlobal("webkitSpeechRecognition", MockRecognition as unknown as typeof SpeechRecognition);

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByLabelText("Speak to agent"));

    await waitFor(() => {
      expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/api/tts"))).toBe(true);
    });
  });

  it("surfaces inline stream errors returned inside chat SSE payloads", async () => {
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [rosterAgent({ id: "claude-sonnet-engineer", name: "Claude Sonnet Engineer", platform: "claude", status: "active" })],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('data: {"error":"batch17 inline stream failure"}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    render(<AgentEngagementConsole />);
    fireEvent.change(screen.getByLabelText("Direct message"), { target: { value: "batch17 stream error" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(screen.getByText(/batch17 inline stream failure/)).toBeInTheDocument();
    });
  });
});
