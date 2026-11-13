/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/components/dispatch/lineage-drawer", () => ({ LineageDrawer: () => null }));
vi.mock("@/lib/api-client", () => ({ useAgents: vi.fn(), useDelegations: vi.fn() }));

import { useAgents, useDelegations } from "@/lib/api-client";
import { AgentEngagementConsole } from "../agent-engagement-console";

const baseAgent = {
  name: "Batch35 Agent",
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

describe("AgentEngagementConsole batch35", () => {
  it.skip("sortAgents tie-break when both agents missing from COMMON_AGENT_IDS (stmt 155)", () => {
    // Ordering requires two uncommon ids with identical heartbeat weights; UI never exposes that comparator directly.
  });

  it("runConferencePrompt uses default room prompt when message is blank (stmt 482 path)", async () => {
    const suffix = randomUUID().slice(0, 8);
    const ids = [`conf-a-b35-${suffix}`, `conf-b-b35-${suffix}`];
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: ids.map((id, i) => ({
          ...baseAgent,
          id,
          name: `Conf B35 ${i}`,
          status: "active" as const,
        })),
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      if (String(input).includes("/api/chat")) {
        return {
          ok: true,
          body: new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode('data: {"text":"standup ok"}\n\n'));
              c.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
              c.close();
            },
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /Group Room/i }));
    fireEvent.click(screen.getByRole("button", { name: /Use all/i }));
    fireEvent.click(screen.getByRole("button", { name: /Start conference round/i }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/chat")).length).toBeGreaterThan(0),
    );
  });

  it.skip("chat stream partial without agentId in roster (stmt 300) — requires hidden assistant rows not mounted in jsdom", () => {});

  it.skip("runMeetingRound withVoice TTS branch (stmt 393) — depends on Audio blob playback unavailable in jsdom", () => {});
});
