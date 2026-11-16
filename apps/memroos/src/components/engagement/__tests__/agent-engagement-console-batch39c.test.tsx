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
  name: "Batch39c Agent",
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

describe("AgentEngagementConsole batch39c", () => {
  it.skip("runAgentTests default roster.map ids (~482) — UI always passes explicit agentIds; never calls runAgentTests()", () => {});

  it("Test primary agents posts only primary roster ids, not directory agents (482 body via map)", async () => {
    const suffix = randomUUID().slice(0, 8);
    const primaryId = `claude-sonnet-engineer-b39c-${suffix}`;
    const directoryId = `directory-only-b39c-${suffix}`;

    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [
          { ...baseAgent, id: primaryId, name: "Primary B39c" },
          { ...baseAgent, id: directoryId, name: "Directory B39c", status: "idle" },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      if (String(input).includes("/api/engagement/test") && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            results: [
              {
                agentId: primaryId,
                name: "Primary B39c",
                status: "active",
                chat: { status: "ready", detail: "ok", runner: "codex" },
                dispatch: { status: "ready", detail: "local", adapter: "local" },
                voice: { status: "ready", detail: "voice ok" },
              },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /Test primary agents/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const engagementCall = fetchMock.mock.calls.find(
      (c) => String(c[0]).includes("/api/engagement/test") && (c[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(engagementCall).toBeTruthy();
    const body = JSON.parse(String((engagementCall?.[1] as RequestInit).body)) as { agentIds: string[] };
    expect(body.agentIds).toEqual([primaryId]);
    expect(body.agentIds).not.toContain(directoryId);
  });
});