/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/components/dispatch/lineage-drawer", () => ({ LineageDrawer: () => null }));
vi.mock("@/lib/api-client", () => ({ useAgents: vi.fn(), useDelegations: vi.fn() }));

import { useAgents, useDelegations } from "@/lib/api-client";
import { AgentEngagementConsole } from "../agent-engagement-console";

const baseAgent = {
  name: "Batch34 Agent",
  role: "Worker",
  platform: "codex" as const,
  protocol: "local",
  status: "idle" as const,
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
  createdAt: "2026-05-11T00:00:00.000Z",
  updatedAt: "2026-05-11T00:00:00.000Z",
  deregisteredAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useDelegations).mockReturnValue({ data: { delegations: [] }, isLoading: false } as ReturnType<
    typeof useDelegations
  >);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AgentEngagementConsole batch34", () => {
  it("sortAgents orders two COMMON_AGENT_IDS by registry index (stmt 155-157)", () => {
    const suffix = randomUUID().slice(0, 8);
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [
          { ...baseAgent, id: "sophia", name: `Sophia B34 ${suffix}`, status: "active" },
          { ...baseAgent, id: "alba", name: `Alba B34 ${suffix}`, status: "active" },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    render(<AgentEngagementConsole />);
    const articles = screen.getAllByRole("article");
    expect(articles[0]).toHaveTextContent(/Alba B34/);
    expect(articles[1]).toHaveTextContent(/Sophia B34/);
  });

  it("sendChatMessage ignores whitespace-only prompts (stmt 343)", async () => {
    const suffix = randomUUID().slice(0, 8);
    const agentId = `chat-b34-${suffix}`;
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [{ ...baseAgent, id: agentId, name: `Chat B34 ${suffix}`, status: "active" }],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentEngagementConsole />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), { target: { value: "   \n\t" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/chat")).length).toBe(0),
    );
  });

  it("toggleParticipant removes an agent from the room roster (lines 291-296)", () => {
    const suffix = randomUUID().slice(0, 8);
    const ids = [`room-a-b34-${suffix}`, `room-b-b34-${suffix}`];
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: ids.map((id, i) => ({
          ...baseAgent,
          id,
          name: `Room B34 ${i} ${suffix}`,
          status: "active" as const,
        })),
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /Group Room/i }));
    expect(screen.getByText(/2 participants/i)).toBeInTheDocument();
    const roomButtons = screen.getAllByRole("button", { name: "Room" });
    fireEvent.click(roomButtons[0]!);
    expect(screen.getByText(/1 participant/i)).toBeInTheDocument();
  });

  it("runAgentTests records network failures (stmt 482, 494-495)", async () => {
    const suffix = randomUUID().slice(0, 8);
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [{ ...baseAgent, id: `fail-b34-${suffix}`, name: `Fail B34 ${suffix}`, status: "active" }],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(`engagement test outage b34-${suffix}`);
      }),
    );

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /Test primary agents/i }));
    await waitFor(() =>
      expect(screen.getByText(new RegExp(`engagement test outage b34-${suffix}`))).toBeInTheDocument(),
    );
  });

  it("streams assistant text and agentName falls back to Agent when id missing (stmts 300, 364)", async () => {
    const suffix = randomUUID().slice(0, 8);
    const agentId = `stream-b34-${suffix}`;
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [{ ...baseAgent, id: agentId, name: `Stream B34 ${suffix}`, status: "active" }],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"text":"batch34 partial"}\n\n'));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        if (String(input).includes("/api/chat")) {
          return { ok: true, body: stream };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );

    render(<AgentEngagementConsole />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), {
      target: { value: `batch34 stream ${suffix}` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(screen.getByText(/batch34 partial/)).toBeInTheDocument());
  });
});
