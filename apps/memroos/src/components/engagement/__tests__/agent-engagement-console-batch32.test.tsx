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
  name: "Batch32 Agent",
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

describe("AgentEngagementConsole batch32", () => {
  it("per-agent Test button enters runAgentTests (line 482 body via explicit id)", async () => {
    const suffix = randomUUID().slice(0, 8);
    const agentId = `solo-b32-${suffix}`;
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [{ ...baseAgent, id: agentId, name: `Solo B32 ${suffix}`, status: "active" }],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        if (String(input).includes("/api/engagement/test") && init?.method === "POST") {
          return {
            ok: true,
            json: async () => ({
              results: [
                {
                  agentId,
                  name: `Solo B32 ${suffix}`,
                  status: "active",
                  chat: { status: "ready", detail: "ok", runner: "codex" },
                  dispatch: { status: "ready", detail: "local", adapter: "local" },
                  voice: { status: "ready", detail: `voice-b32-${suffix}` },
                },
              ],
            }),
          };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /^Test$/i }));
    await waitFor(() => expect(screen.getByText(new RegExp(`voice-b32-${suffix}`))).toBeInTheDocument());
  });
});
