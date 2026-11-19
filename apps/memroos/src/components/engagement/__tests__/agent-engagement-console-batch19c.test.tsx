/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

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
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, messages: [] }),
    })),
  );
});

describe("AgentEngagementConsole batch19c", () => {
  it("shows empty state when no agents are registered", () => {
    vi.mocked(useAgents).mockReturnValue({
      data: { agents: [] },
      isLoading: false,
    } as ReturnType<typeof useAgents>);
    vi.mocked(useDelegations).mockReturnValue({
      data: { delegations: [] },
      isLoading: false,
    } as ReturnType<typeof useDelegations>);

    render(<AgentEngagementConsole />);
    expect(screen.getByText(/No agents match the current filters/i)).toBeInTheDocument();
    expect(screen.getByText(/0 active \/ 0 registered/i)).toBeInTheDocument();
  });

  it("shows room session controls after selecting group room mode", async () => {
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
    await waitFor(() => {
      expect(screen.getByText(/Room session/i)).toBeInTheDocument();
    });
  });
});
