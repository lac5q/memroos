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
  name: "Batch24 Agent",
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
  vi.mocked(useDelegations).mockReturnValue({ data: { delegations: [] }, isLoading: false } as ReturnType<typeof useDelegations>);
});

describe("AgentEngagementConsole batch24", () => {
  it("sorts non-common agents by status then name", () => {
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [
          { ...baseAgent, id: "zeta-batch24", name: "Zeta", status: "idle" },
          { ...baseAgent, id: "alpha-batch24", name: "Alpha", status: "idle" },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    render(<AgentEngagementConsole />);
    const names = screen.getAllByText(/Alpha|Zeta/).map((el) => el.textContent);
    expect(names.indexOf("Alpha")).toBeLessThan(names.indexOf("Zeta"));
  });

  it("surfaces stream errors from chat SSE payloads", async () => {
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [
          { ...baseAgent, id: "chat-agent-b24", name: "Chat Agent", status: "active" },
          { ...baseAgent, id: "room-agent-b24", name: "Room Agent", status: "active" },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/api/chat")) {
          return {
            ok: true,
            body: new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('data: {"error":"stream broke batch24"}\n\n'));
                controller.close();
              },
            }),
          };
        }
        if (url.includes("/api/tts")) {
          return { ok: false, status: 503, blob: async () => new Blob([]) };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );

    render(<AgentEngagementConsole />);
    fireEvent.change(screen.getByPlaceholderText(/Message/i), { target: { value: "hello batch24" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(screen.getByText(/stream broke batch24/i)).toBeInTheDocument());

  });
});
