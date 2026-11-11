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

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

describe("AgentEngagementConsole batch18b", () => {
  it("shows loading copy while roster is fetching", () => {
    vi.mocked(useAgents).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as ReturnType<typeof useAgents>);
    vi.mocked(useDelegations).mockReturnValue({
      data: { delegations: [] },
      isLoading: false,
    } as ReturnType<typeof useDelegations>);

    render(<AgentEngagementConsole />);
    expect(screen.getByText(/Loading agents\.\.\./i)).toBeInTheDocument();
  });

  it("renders recent delegations when hive rows exist", () => {
    vi.mocked(useAgents).mockReturnValue({
      data: { agents: [] },
      isLoading: false,
    } as ReturnType<typeof useAgents>);
    vi.mocked(useDelegations).mockReturnValue({
      data: {
        delegations: [
          {
            task_id: "task-b18b",
            from_agent: "manager",
            to_agent: "codex-cli-agent",
            task_summary: "Batch18b delegation summary",
            status: "in_progress",
            started_at: "2026-07-18T12:00:00.000Z",
          },
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useDelegations>);

    render(<AgentEngagementConsole />);
    expect(screen.getByText(/Batch18b delegation summary/)).toBeInTheDocument();
  });

  it("filters roster search input client-side", () => {
    vi.mocked(useAgents).mockReturnValue({
      data: {
        agents: [
          {
            id: "alpha-agent",
            name: "Alpha Visible",
            role: "Worker",
            platform: "codex",
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
            id: "beta-agent",
            name: "Beta Hidden",
            role: "Worker",
            platform: "codex",
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
        ],
      },
      isLoading: false,
    } as ReturnType<typeof useAgents>);
    vi.mocked(useDelegations).mockReturnValue({
      data: { delegations: [] },
      isLoading: false,
    } as ReturnType<typeof useDelegations>);

    render(<AgentEngagementConsole />);
    fireEvent.change(screen.getByLabelText("Filter agents"), { target: { value: "Alpha" } });
    expect(screen.getAllByText("Alpha Visible").length).toBeGreaterThan(0);
    expect(screen.queryByText("Beta Hidden")).not.toBeInTheDocument();
  });
});
