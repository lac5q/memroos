/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  useAgents: vi.fn(),
  useHiveFeed: vi.fn(),
  useAgentPeers: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  useAgents: api.useAgents,
  useHiveFeed: api.useHiveFeed,
  useAgentPeers: api.useAgentPeers,
}));

vi.mock("@/components/shared/charts", () => ({
  HBars: ({ rows }: { rows: { label: string; value: number }[] }) => (
    <div data-testid="hbars">{rows.map((r) => `${r.label}:${r.value}`).join(",")}</div>
  ),
}));

import { AgentWorkload } from "../agent-workload";

const livenessObs = (state: string, extra: Record<string, unknown> = {}) => ({
  state,
  observedAt: "2026-07-15T12:00:00.000Z",
  freshnessMs: 1000,
  source: "sqlite://registered_agents",
  reason: `${state} reason`,
  ...extra,
});

describe("AgentWorkload batch34b", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows hive error, loading, and workload bar branches", () => {
    api.useAgents.mockReturnValue({ data: undefined, isError: true, isLoading: false });
    api.useHiveFeed.mockReturnValue({
      data: undefined,
      isError: true,
      isLoading: false,
      dataUpdatedAt: null,
    });
    api.useAgentPeers.mockReturnValue({ data: { peers: [{ agent_id: "peer-1" }] }, isError: false, isLoading: false });
    const { rerender } = render(<AgentWorkload />);
    expect(screen.getByText(/Failed to load \/api\/hive/i)).toBeInTheDocument();
    expect(screen.getByText(/1 active/)).toBeInTheDocument();

    api.useHiveFeed.mockReturnValue({
      data: undefined,
      isError: false,
      isLoading: true,
      dataUpdatedAt: null,
    });
    rerender(<AgentWorkload filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByText(/Loading \/api\/hive and \/api\/agents/i)).toBeInTheDocument();

    api.useHiveFeed.mockReturnValue({
      data: {
        actions: [
          { agent_id: "worker-1", action_type: "task" },
          { agent_id: "worker-1", action_type: "error" },
        ],
      },
      isError: false,
      isLoading: false,
      dataUpdatedAt: "2026-07-15T12:00:00.000Z",
    });
    api.useAgents.mockReturnValue({
      data: {
        agents: [],
        summary: { active: { value: 2, status: "live" } },
        liveness: { value: null, status: "empty", reason: null },
      },
      isError: false,
      isLoading: false,
    });
    rerender(<AgentWorkload />);
    expect(screen.getByTestId("hbars")).toHaveTextContent("worker-1:2");
    expect(screen.getByText(/1 errors/)).toBeInTheDocument();
  });

  it("renders liveness counts, reason copy, and stale badges", () => {
    api.useHiveFeed.mockReturnValue({
      data: { actions: [] },
      isError: false,
      isLoading: false,
      dataUpdatedAt: "2026-07-15T12:00:00.000Z",
    });
    api.useAgentPeers.mockReturnValue({ data: { peers: [] }, isError: false, isLoading: false });
    api.useAgents.mockReturnValue({
      data: {
        agents: [
          { id: "a1", name: "A1", liveness: livenessObs("live") },
          { id: "a2", name: "A2", liveness: livenessObs("stale") },
          { id: "a3", name: "A3", liveness: livenessObs("never") },
          { id: "a4", name: "A4", liveness: livenessObs("missing") },
          { id: "a5", name: "A5", liveness: livenessObs("error") },
        ],
        summary: { active: { value: 1 } },
        liveness: { value: 1, status: "degraded", reason: "mixed liveness states" },
      },
      isError: false,
      isLoading: false,
    });

    render(<AgentWorkload />);
    const block = screen.getByTestId("agent-workload-liveness");
    expect(block.textContent).toMatch(/1\/5 live/);
    expect(block.textContent).toMatch(/live 1/);
    expect(block.textContent).toMatch(/stale 1/);
    expect(block.textContent).toMatch(/never 1/);
    expect(block.textContent).toMatch(/missing 1/);
    expect(block.textContent).toMatch(/error 1/);
    expect(block.textContent).toMatch(/mixed liveness states/);
  });

  it("shows agents loading copy when roster is still fetching", () => {
    api.useHiveFeed.mockReturnValue({
      data: { actions: [] },
      isError: false,
      isLoading: false,
      dataUpdatedAt: "2026-07-15T12:00:00.000Z",
    });
    api.useAgentPeers.mockReturnValue({ data: { peers: [] }, isError: false, isLoading: false });
    api.useAgents.mockReturnValue({ data: undefined, isError: false, isLoading: true });

    render(<AgentWorkload />);
    expect(screen.getByText(/Loading \/api\/agents liveness/i)).toBeInTheDocument();
  });
});
