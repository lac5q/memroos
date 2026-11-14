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
  name: "Batch29 Agent",
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
  URL.createObjectURL = vi.fn(() => "blob:engagement-batch29");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AgentEngagementConsole batch29 — sortAgents non-common vs common, busy guards", () => {
  it("sortAgents: non-common directory agent lists after common primary (line 155 branch: a not common, b common)", () => {
    const suffix = randomUUID().slice(0, 8);
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [
          { ...baseAgent, id: `custom-batch29-${suffix}`, name: `Custom Batch29 ${suffix}`, status: "active" },
          { ...baseAgent, id: "gwen", name: `Gwen Batch29 ${suffix}`, status: "idle" },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    render(<AgentEngagementConsole />);
    const custom = screen.getAllByText(`Custom Batch29 ${suffix}`).find((el) => el.tagName === "SPAN");
    const gwen = screen.getAllByText(`Gwen Batch29 ${suffix}`).find((el) => el.tagName === "SPAN");
    expect(custom).toBeTruthy();
    expect(gwen).toBeTruthy();
    const articles = screen.getAllByRole("article");
    const indexCustom = articles.findIndex((el) => el.contains(custom));
    const indexGwen = articles.findIndex((el) => el.contains(gwen));
    expect(indexGwen).toBeLessThan(indexCustom);
  });

  it("sendChatMessage busy guard ignores second send while fetch pending (line 343)", async () => {
    vi.mocked(useAgents).mockReturnValue({
      data: { agents: [{ ...baseAgent, id: "chat-busy-b29", name: "Chat Busy B29", status: "active" }] },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    let resolveChat: (v: Response) => void = () => {};
    const chatPromise = new Promise<Response>((resolve) => {
      resolveChat = resolve;
    });

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      if (String(input).includes("/api/chat")) {
        return chatPromise;
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentEngagementConsole />);
    fireEvent.change(screen.getByPlaceholderText(/Message Chat Busy B29/i), {
      target: { value: "first line batch29" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    fireEvent.change(screen.getByPlaceholderText(/Message Chat Busy B29/i), {
      target: { value: "second line batch29 should not send" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/chat")).length).toBe(1);

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"text":"ok-b29"}\n\n'));
        controller.close();
      },
    });
    resolveChat({ ok: true, body: stream } as Response);

    await waitFor(() => expect(screen.getByText(/ok-b29/)).toBeInTheDocument());
  });

  it("runMeetingRound early return when room has zero participants (line 393)", async () => {
    const suffix = randomUUID().slice(0, 8);
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [
          { ...baseAgent, id: `room-a-b29-${suffix}`, name: `Room A ${suffix}`, status: "dormant" },
          { ...baseAgent, id: `room-b-b29-${suffix}`, name: `Room B ${suffix}`, status: "dormant" },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /Group Room/i }));
    const roomButtons = screen.getAllByRole("button", { name: /^Room$/i });
    fireEvent.click(roomButtons[0]!);
    fireEvent.click(roomButtons[1]!);

    fireEvent.change(screen.getByPlaceholderText(/Ask the room something/i), {
      target: { value: "prompt with no participants batch29" },
    });
    const sendRoom = screen.getByRole("button", { name: "Send room prompt" });
    expect(sendRoom).toBeDisabled();
    fireEvent.click(sendRoom);

    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });
});
