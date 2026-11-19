/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/components/dispatch/lineage-drawer", () => ({
  LineageDrawer: () => null,
}));

vi.mock("@/lib/api-client", () => ({
  useAgents: vi.fn(),
  useDelegations: vi.fn(),
}));

import { useAgents, useDelegations } from "@/lib/api-client";
import { AgentEngagementConsole } from "../agent-engagement-console";

const baseAgent = {
  id: "codex-cli-agent",
  name: "Codex Agent",
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
  createdAt: "2026-05-11T00:00:00Z",
  updatedAt: "2026-05-11T00:00:00Z",
  deregisteredAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

describe("AgentEngagementConsole batch19", () => {
  it("hides paperclip support agents unless support roster is enabled", () => {
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [
          baseAgent,
          {
            ...baseAgent,
            id: "paperclip-pmo-agent",
            name: "Paperclip PMO",
            role: "pmo-agent",
            metadata: { source: "paperclip" },
          },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);
    vi.mocked(useDelegations).mockReturnValue({
      data: { delegations: [] },
      isLoading: false,
    } as ReturnType<typeof useDelegations>);

    render(<AgentEngagementConsole />);
    expect(screen.queryByText("Paperclip PMO")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Show system/i }));
    expect(screen.getByText("Paperclip PMO")).toBeInTheDocument();
  });

  it("switches to group room mode and shows room participant copy", () => {
    vi.mocked(useAgents).mockReturnValue({
      data: { agents: [baseAgent] },
      isLoading: false,
    } as ReturnType<typeof useAgents>);
    vi.mocked(useDelegations).mockReturnValue({
      data: { delegations: [] },
      isLoading: false,
    } as ReturnType<typeof useDelegations>);

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /Group Room/i }));
    expect(screen.getAllByText(/Run one shared standup/i).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Room prompt")).toBeInTheDocument();
  });

  it("metadataText fallback keeps console rendering when metadata is circular", () => {
    const circular: Record<string, unknown> = { source: "codex" };
    circular.self = circular;
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [{ ...baseAgent, metadata: circular }],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);
    vi.mocked(useDelegations).mockReturnValue({
      data: { delegations: [] },
      isLoading: false,
    } as ReturnType<typeof useDelegations>);

    render(<AgentEngagementConsole />);
    expect(screen.getAllByText("Codex Agent").length).toBeGreaterThan(0);
  });
});
