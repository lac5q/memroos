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
  name: "Batch28c Agent",
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
  URL.createObjectURL = vi.fn(() => "blob:engagement-batch28c");
  URL.revokeObjectURL = vi.fn();
});

describe("AgentEngagementConsole batch28c — roster ordering, TTS failure, agent tests", () => {
  it("lists common roster agents before non-common directory agents (lines 154-157)", () => {
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [
          { ...baseAgent, id: "custom-batch28c", name: "Custom Batch28c", status: "active" },
          { ...baseAgent, id: "alba", name: "Alba Batch28c", status: "idle" },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    render(<AgentEngagementConsole />);
    const names = screen.getAllByText(/Alba Batch28c|Custom Batch28c/).map((el) => el.textContent);
    expect(names.indexOf("Alba Batch28c")).toBeLessThan(names.indexOf("Custom Batch28c"));
  });

  it("surfaces chat stream errors in assistant history (lines 343, 372-381)", async () => {
    vi.mocked(useAgents).mockReturnValue({
      data: { agents: [{ ...baseAgent, id: "chat-batch28c", name: "Chat Batch28c", status: "active" }] },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        if (String(input).includes("/api/chat")) {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode('data: {"error":"{\\"message\\":\\"runner offline batch28c\\"}"}\n\n'),
              );
              controller.close();
            },
          });
          return { ok: true, body: stream };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );

    render(<AgentEngagementConsole />);
    fireEvent.change(screen.getByPlaceholderText(/Message Chat Batch28c/i), {
      target: { value: "hello batch28c" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(screen.getByText(/Chat unavailable:/i)).toBeInTheDocument());
  });

  it("runAgentTests merges engagement diagnostics into checks (lines 482-493)", async () => {
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [{ ...baseAgent, id: "diag-batch28c", name: "Diag Batch28c", status: "active" }],
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
                  agentId: "diag-batch28c",
                  name: "Diag Batch28c",
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
      }),
    );

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Test$/i })[0]!);
    await waitFor(() => expect(screen.getAllByText(/voice ok/i).length).toBeGreaterThan(0));
  });

  it("records engagement test network failures (lines 494-495)", async () => {
    vi.mocked(useAgents).mockReturnValue({
      data: { agents: [{ ...baseAgent, id: "net-batch28c", name: "Net Batch28c", status: "active" }] },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        if (String(input).includes("/api/engagement/test") && init?.method === "POST") {
          throw new Error("engagement network batch28c");
        }
        return { ok: true, json: async () => ({}) };
      }),
    );

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /Test primary agents/i }));
    await waitFor(() => expect(screen.getByText(/engagement network batch28c/i)).toBeInTheDocument());
  });
});
