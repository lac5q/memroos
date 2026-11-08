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
  name: "Batch29e Agent",
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
  URL.createObjectURL = vi.fn(() => "blob:engagement-batch29e");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AgentEngagementConsole batch29e — force sortAgents L155 and busy L343", () => {
  it("sortAgents hits a-not-common vs b-common inside primary roster (line 155)", () => {
    const suffix = randomUUID().slice(0, 8);
    // All status:active so custom ids join primary alongside common ids.
    // Put common agents LAST so V8 comparisons include (custom, common).
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [
          { ...baseAgent, id: `z-custom-a-${suffix}`, name: `Z Custom A ${suffix}`, status: "active" },
          { ...baseAgent, id: `y-custom-b-${suffix}`, name: `Y Custom B ${suffix}`, status: "active" },
          { ...baseAgent, id: `x-custom-c-${suffix}`, name: `X Custom C ${suffix}`, status: "active" },
          { ...baseAgent, id: "alba", name: `Alba ${suffix}`, status: "active" },
          { ...baseAgent, id: "gwen", name: `Gwen ${suffix}`, status: "active" },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    render(<AgentEngagementConsole />);
    const articles = screen.getAllByRole("article");
    const names = articles.map((el) => el.textContent ?? "");
    const albaIdx = names.findIndex((t) => t.includes(`Alba ${suffix}`));
    const customIdx = names.findIndex((t) => t.includes(`Z Custom A ${suffix}`));
    expect(albaIdx).toBeGreaterThanOrEqual(0);
    expect(customIdx).toBeGreaterThanOrEqual(0);
    expect(albaIdx).toBeLessThan(customIdx);
  });

  it("sendChatMessage returns early once busy is set (line 343)", async () => {
    vi.mocked(useAgents).mockReturnValue({
      data: { agents: [{ ...baseAgent, id: "chat-busy-b29e", name: "Chat Busy B29e", status: "active" }] },
      isLoading: false,
    } as ReturnType<typeof useAgents>);

    let resolveChat: (v: Response) => void = () => {};
    const chatPromise = new Promise<Response>((resolve) => {
      resolveChat = resolve;
    });

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      if (String(input).includes("/api/chat")) return chatPromise;
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentEngagementConsole />);
    fireEvent.change(screen.getByPlaceholderText(/Message Chat Busy B29e/i), {
      target: { value: "first batch29e" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled());

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/Message Chat Busy B29e/i), {
        target: { value: "second should be ignored" },
      });
      // Force click even if still disabled — handler still guards on busy.
      fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    });

    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/chat")).length).toBe(1);

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"text":"ok-b29e"}\n\n'));
        controller.close();
      },
    });
    resolveChat({ ok: true, body: stream } as Response);
    await waitFor(() => expect(screen.getByText(/ok-b29e/)).toBeInTheDocument());
  });
});
