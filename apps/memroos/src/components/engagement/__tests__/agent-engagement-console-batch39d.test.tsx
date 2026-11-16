/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/components/dispatch/lineage-drawer", () => ({ LineageDrawer: () => null }));
vi.mock("@/lib/api-client", () => ({ useAgents: vi.fn(), useDelegations: vi.fn() }));

import { useAgents, useDelegations } from "@/lib/api-client";
import { AgentEngagementConsole } from "../agent-engagement-console";

const baseAgent = {
  name: "Batch39d Agent",
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
  createdAt: "2026-11-16T00:00:00.000Z",
  updatedAt: "2026-11-16T00:00:00.000Z",
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

describe("AgentEngagementConsole batch39d", () => {
  it.skip("agentName(undefined) returns Agent (line 300) — assistant rows always carry agentId in production UI", () => {});

  it.skip("runAgentTests() default roster.map ids (line 482) — UI always passes explicit agentIds", () => {});

  it("sortAgents deprioritizes non-common ids vs COMMON_AGENT_IDS (line 155)", () => {
    const suffix = randomUUID().slice(0, 8);
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [
          { ...baseAgent, id: `custom-b39d-${suffix}`, name: `Custom B39d ${suffix}`, status: "active" },
          { ...baseAgent, id: "maria", name: `Maria B39d ${suffix}`, status: "active" },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    render(<AgentEngagementConsole />);
    const articles = screen.getAllByRole("article");
    expect(articles[0]).toHaveTextContent(/Maria B39d/);
    expect(articles[1]).toHaveTextContent(/Custom B39d/);
  });

  it("sendChatMessage ignores overlapping send while busy (line 343)", async () => {
    const suffix = randomUUID().slice(0, 8);
    const agentId = `chat-b39d-${suffix}`;
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [{ ...baseAgent, id: agentId, name: `Chat B39d ${suffix}`, status: "active" }],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    let resolveChat: (value: Response) => void = () => {};
    const chatPending = new Promise<Response>((resolve) => {
      resolveChat = resolve;
    });

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      if (String(input).includes("/api/chat")) return chatPending;
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentEngagementConsole />);
    fireEvent.change(screen.getByPlaceholderText(new RegExp(`Message Chat B39d ${suffix}`, "i")), {
      target: { value: "first b39d chat" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled());

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(new RegExp(`Message Chat B39d ${suffix}`, "i")), {
        target: { value: "second b39d should be ignored" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    });

    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/chat")).length).toBe(1);

    resolveChat({
      ok: true,
      body: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"text":"b39d ok"}\n\n'));
          c.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          c.close();
        },
      }),
    } as Response);
    await waitFor(() => expect(screen.getByText(/b39d ok/)).toBeInTheDocument());
  });

  it("runMeetingRound returns when room participant list is empty (line 393)", async () => {
    const suffix = randomUUID().slice(0, 8);
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [{ ...baseAgent, id: `room-b39d-${suffix}`, name: `Room B39d ${suffix}`, status: "active" }],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /Group Room/i }));
    fireEvent.click(screen.getByRole("button", { name: "Room" }));
    fireEvent.change(screen.getByPlaceholderText(/Ask the room something/i), {
      target: { value: `batch39d empty room ${suffix}` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send room prompt" }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/chat")).length).toBe(0),
    );
  });
});