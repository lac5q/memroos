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
  useDelegations: vi.fn(),
}));

import { useAgents, useDelegations } from "@/lib/api-client";
import { AgentEngagementConsole } from "../agent-engagement-console";

const commonAgent = {
  id: "codex-cli-agent",
  name: "Codex Agent",
  role: "Worker",
  platform: "codex" as const,
  protocol: "local",
  status: "active" as const,
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
};

const directoryAgent = {
  ...commonAgent,
  id: "batch22-directory",
  name: "Directory Agent",
  status: "idle" as const,
};

function mockAgents(agents: typeof commonAgent[]) {
  vi.mocked(useAgents).mockReturnValue({
    data: { agents },
    isLoading: false,
  } as ReturnType<typeof useAgents>);
  vi.mocked(useDelegations).mockReturnValue({
    data: { delegations: [] },
    isLoading: false,
  } as ReturnType<typeof useDelegations>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  URL.createObjectURL = vi.fn(() => "blob:batch22");
  URL.revokeObjectURL = vi.fn();
});

describe("AgentEngagementConsole batch22", () => {
  it("orders primary common agents before directory agents", () => {
    mockAgents([directoryAgent, commonAgent]);
    render(<AgentEngagementConsole />);
    expect(screen.getByText("Primary agents")).toBeInTheDocument();
    expect(screen.getByText("Registered directory")).toBeInTheDocument();
    const cardText = document.body.textContent ?? "";
    expect(cardText.indexOf("Codex Agent")).toBeLessThan(cardText.indexOf("Directory Agent"));
  });

  it("surfaces chat stream HTTP errors and TTS audio failures", async () => {
    mockAgents([commonAgent]);
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/chat")) {
        return new Response('{"error":{"message":"batch22 chat down"}}', { status: 503 });
      }
      if (url.includes("/api/tts")) {
        return new Response("nope", { status: 503 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    class FailAudio {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      pause = vi.fn();
      play = vi.fn().mockImplementation(async () => {
        this.onerror?.();
      });
    }
    vi.stubGlobal("Audio", FailAudio);

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /Direct Chat/i }));
    fireEvent.change(screen.getByLabelText("Direct message"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(screen.getByText(/Chat unavailable/i)).toBeInTheDocument();
    });
  });

  it("runs primary-agent test batch and network failure copy", async () => {
    mockAgents([commonAgent, directoryAgent]);
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).includes("/api/engagement/test")) {
        const body = JSON.parse(String(init?.body)) as { agentIds?: string[] };
        expect(body.agentIds).toEqual([commonAgent.id]);
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /Test primary agents/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/engagement/test",
        expect.objectContaining({ method: "POST" }),
      );
    });

    vi.mocked(fetch).mockRejectedValueOnce(new Error("batch22 offline"));
    fireEvent.click(screen.getByRole("button", { name: /Test primary agents/i }));
    await waitFor(() => {
      expect(screen.getByText(/batch22 offline/i)).toBeInTheDocument();
    });
  });
});
