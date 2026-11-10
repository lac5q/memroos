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
  name: "Batch33 Agent",
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

describe("AgentEngagementConsole batch33", () => {
  it("sortAgents ranks a common id before a non-common id (lines 155-156)", () => {
    const suffix = randomUUID().slice(0, 8);
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [
          { ...baseAgent, id: `zeta-b33-${suffix}`, name: `Zeta B33 ${suffix}`, status: "active" },
          { ...baseAgent, id: "alba", name: `Alba B33 ${suffix}`, status: "active" },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    render(<AgentEngagementConsole />);
    const articles = screen.getAllByRole("article");
    const text = articles.map((el) => el.textContent ?? "");
    expect(text[0]).toMatch(/Alba B33/);
    expect(text[1]).toMatch(/Zeta B33/);
  });

  it("metadataText survives circular metadata (lines 110-112)", () => {
    const suffix = randomUUID().slice(0, 8);
    const circular: Record<string, unknown> = { source: "batch33" };
    circular.self = circular;
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [
          {
            ...baseAgent,
            id: `meta-b33-${suffix}`,
            name: `Meta B33 ${suffix}`,
            status: "active",
            metadata: circular,
          },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    render(<AgentEngagementConsole />);
    expect(screen.getAllByText(new RegExp(`Meta B33 ${suffix}`)).length).toBeGreaterThan(0);
  });

  it("runMeetingRound bails when no room participants remain (line 393)", async () => {
    const suffix = randomUUID().slice(0, 8);
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [{ ...baseAgent, id: `room-b33-${suffix}`, name: `Room B33 ${suffix}`, status: "active" }],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /Group Room/i }));
    fireEvent.click(screen.getByRole("button", { name: "Room" }));
    fireEvent.change(screen.getByPlaceholderText(/Ask the room something/i), {
      target: { value: "batch33 empty room prompt" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send room prompt" }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/chat")).length).toBe(0),
    );
  });

  it("runAgentTests merges explicit roster ids (line 482)", async () => {
    const suffix = randomUUID().slice(0, 8);
    const ids = [`roster-a-b33-${suffix}`, `roster-b-b33-${suffix}`];
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: ids.map((id, index) => ({
          ...baseAgent,
          id,
          name: `Roster B33 ${index} ${suffix}`,
          status: "active" as const,
        })),
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        if (String(input).includes("/api/engagement/test") && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as { agentIds: string[] };
          expect(body.agentIds).toEqual(ids);
          return {
            ok: true,
            json: async () => ({
              results: ids.map((agentId, index) => ({
                agentId,
                name: `Roster B33 ${index} ${suffix}`,
                status: "active",
                chat: { status: "ready", detail: "ok", runner: "codex" },
                dispatch: { status: "ready", detail: "local", adapter: "local" },
                voice: { status: "ready", detail: `voice-b33-${suffix}-${index}` },
              })),
            }),
          };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /Test primary agents/i }));
    await waitFor(() => expect(screen.getByText(new RegExp(`voice-b33-${suffix}-0`))).toBeInTheDocument());
  });

  it("runMeetingRound surfaces per-agent chat failures (lines 442-454)", async () => {
    const suffix = randomUUID().slice(0, 8);
    const ids = [`fail-a-b33-${suffix}`, `fail-b-b33-${suffix}`];
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: ids.map((id, index) => ({
          ...baseAgent,
          id,
          name: `Fail B33 ${index} ${suffix}`,
          status: "active" as const,
        })),
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        if (String(input).includes("/api/chat")) {
          return { ok: false, text: async () => "not-json-chat-failure-b33" };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /Group Room/i }));
    fireEvent.change(screen.getByPlaceholderText(/Ask the room something/i), {
      target: { value: "batch33 room failure prompt" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send room prompt" }));

    await waitFor(() =>
      expect(screen.getAllByText(/Chat unavailable:/i).length).toBeGreaterThan(0),
    );
  });
});
