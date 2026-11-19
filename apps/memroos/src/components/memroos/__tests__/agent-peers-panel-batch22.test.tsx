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

describe("AgentPeersPanel batch22", () => {
  it("formats hour and day relative timestamps", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();

    mockUseAgentPeers.mockReturnValue({
      data: {
        peers: [
          { agent_id: "recent", current_task: "Sync", status: "continue", last_seen: twoHoursAgo },
          { agent_id: "older", current_task: "Idle", status: "stop", last_seen: threeDaysAgo },
        ],
        window_minutes: 60,
        timestamp: new Date().toISOString(),
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useAgentPeers>);

    render(<AgentPeersPanel />);
    expect(screen.getByText("2h ago")).toBeInTheDocument();
    expect(screen.getByText("3d ago")).toBeInTheDocument();
  });
});
