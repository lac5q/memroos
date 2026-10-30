/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/components/dispatch/lineage-drawer", () => ({ LineageDrawer: () => null }));
vi.mock("@/lib/api-client", () => ({ useAgents: vi.fn(), useDelegations: vi.fn() }));

import { useAgents, useDelegations } from "@/lib/api-client";
import { AgentEngagementConsole } from "../agent-engagement-console";

const baseAgent = {
  name: "Batch23 Agent",
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
  createdAt: "2026-05-11T00:00:00.000Z",
  updatedAt: "2026-05-11T00:00:00.000Z",
  deregisteredAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useDelegations).mockReturnValue({ data: { delegations: [] }, isLoading: false } as ReturnType<typeof useDelegations>);
});

describe("AgentEngagementConsole batch23", () => {
  it("prioritizes common agent ids in the roster ordering", () => {
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [
          { ...baseAgent, id: "zz-rare-batch23", name: "ZZ Rare" },
          { ...baseAgent, id: "codex-cli-agent", name: "Codex CLI" },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    render(<AgentEngagementConsole />);
    const names = screen.getAllByText(/Codex CLI|ZZ Rare/).map((el) => el.textContent);
    expect(names.indexOf("Codex CLI")).toBeLessThan(names.indexOf("ZZ Rare"));
  });

  it("surfaces chat HTTP failures and agent test network errors", async () => {
    vi.mocked(useAgents).mockReturnValue({
      data: { agents: [{ ...baseAgent, id: "chat-agent-batch23" }] },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/api/chat")) {
          return { ok: false, status: 502, text: async () => '{"error":{"message":"chat batch23 down"}}' };
        }
        if (url.includes("/api/engagement/test")) {
          throw new Error("network batch23");
        }
        return { ok: true, json: async () => ({}) };
      }),
    );

    render(<AgentEngagementConsole />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), { target: { value: "hello batch23" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(screen.getByText(/chat batch23 down/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Test primary agents/i }));
    await waitFor(() => expect(screen.getByText(/network batch23/i)).toBeInTheDocument());
  });
});
