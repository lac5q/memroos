/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/components/dispatch/lineage-drawer", () => ({
  LineageDrawer: () => null,
}));

const mockAgents = [
  {
    id: "claude-sonnet-engineer",
    name: "Claude Sonnet Engineer",
    role: "CLI engineer",
    platform: "claude",
    protocol: "local",
    status: "active",
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
    createdAt: "2026-05-11T00:00:00Z",
    updatedAt: "2026-05-11T00:00:00Z",
    deregisteredAt: null,
  },
  {
    id: "dormant-agent",
    name: "Dormant Agent",
    role: "Idle worker",
    platform: "codex",
    protocol: "local",
    status: "dormant",
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
    createdAt: "2026-05-11T00:00:00Z",
    updatedAt: "2026-05-11T00:00:00Z",
    deregisteredAt: null,
  },
];

vi.mock("@/lib/api-client", () => ({
  useAgents: vi.fn(),
  useDelegations: vi.fn(() => ({
    data: { delegations: [] },
    isLoading: false,
  })),
}));

import { useAgents } from "@/lib/api-client";
import { AgentEngagementConsole } from "../agent-engagement-console";

function chatStream(text: string): Response {
  return new Response(`data: {"text":"${text}"}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAgents).mockReturnValue({
    data: { agents: mockAgents },
    isLoading: false,
  } as ReturnType<typeof useAgents>);
  vi.stubGlobal("fetch", vi.fn());
});

describe("AgentEngagementConsole batch15b", () => {
  it("filters roster by dormant status", () => {
    render(<AgentEngagementConsole />);
    fireEvent.change(screen.getByLabelText("Filter by agent status"), { target: { value: "dormant" } });
    expect(screen.getAllByText("Dormant Agent").length).toBeGreaterThan(0);
    expect(screen.queryByText("Claude Sonnet Engineer")).not.toBeInTheDocument();
  });

  it("sends a custom room prompt when message text is provided", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(chatStream("Custom room reply"));
    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: "Group Room" }));
    fireEvent.change(screen.getByLabelText("Room prompt"), {
      target: { value: "Custom room agenda for batch15b" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send room prompt" }));

    await waitFor(() => {
      const [, init] = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(String(init?.body));
      expect(body.message).toContain("Custom room agenda for batch15b");
      expect(screen.getByText("Custom room reply")).toBeInTheDocument();
    });
  });
});
