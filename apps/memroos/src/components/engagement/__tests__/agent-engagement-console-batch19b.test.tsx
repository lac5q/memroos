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

describe("AgentEngagementConsole batch19b", () => {
  it("shows loading placeholder while agents query is in flight", () => {
    vi.mocked(useAgents).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as ReturnType<typeof useAgents>);
    vi.mocked(useDelegations).mockReturnValue({
      data: { delegations: [] },
      isLoading: false,
    } as ReturnType<typeof useDelegations>);

    render(<AgentEngagementConsole />);
    expect(screen.getByText(/Loading agents/i)).toBeInTheDocument();
  });

  it("direct mode exposes per-agent prompt textarea", () => {
    vi.mocked(useAgents).mockReturnValue({
      data: { agents: [baseAgent] },
      isLoading: false,
    } as ReturnType<typeof useAgents>);
    vi.mocked(useDelegations).mockReturnValue({
      data: { delegations: [] },
      isLoading: false,
    } as ReturnType<typeof useDelegations>);

    render(<AgentEngagementConsole />);
    fireEvent.click(screen.getByRole("button", { name: /Direct Chat/i }));
    expect(screen.getByLabelText("Direct message")).toBeInTheDocument();
  });
});
