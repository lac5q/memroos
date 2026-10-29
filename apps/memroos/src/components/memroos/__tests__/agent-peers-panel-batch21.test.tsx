/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/api-client", () => ({
  useAgentPeers: vi.fn(),
}));

import { useAgentPeers } from "@/lib/api-client";
import { AgentPeersPanel } from "../agent-peers-panel";

const mockUseAgentPeers = vi.mocked(useAgentPeers);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AgentPeersPanel batch21", () => {
  it("uses default color for unknown statuses and just-now timestamps", () => {
    mockUseAgentPeers.mockReturnValue({
      data: {
        peers: [
          {
            agent_id: "scout",
            current_task: "Indexing docs",
            status: "exploring",
            last_seen: new Date().toISOString(),
          },
        ],
        window_minutes: 60,
        timestamp: new Date().toISOString(),
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useAgentPeers>);

    render(<AgentPeersPanel />);
    expect(screen.getByText("exploring")).toBeInTheDocument();
    expect(screen.getByText("just now")).toBeInTheDocument();
  });

  it("respects custom window minutes in the empty state", () => {
    mockUseAgentPeers.mockReturnValue({
      data: { peers: [], window_minutes: 15, timestamp: new Date().toISOString() },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useAgentPeers>);

    render(<AgentPeersPanel windowMinutes={15} />);
    expect(screen.getByText(/No active peers in the last 15 minutes/i)).toBeInTheDocument();
  });

  it("formats multi-day last seen via catch-safe slice fallback", () => {
    mockUseAgentPeers.mockReturnValue({
      data: {
        peers: [
          {
            agent_id: "legacy",
            current_task: "Idle",
            status: "stop",
            last_seen: "also-not-a-date",
          },
        ],
        window_minutes: 60,
        timestamp: new Date().toISOString(),
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useAgentPeers>);

    render(<AgentPeersPanel />);
    expect(screen.getByText("also-not-a-date".slice(0, 16))).toBeInTheDocument();
  });
});
