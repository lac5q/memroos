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

describe("AgentPeersPanel batch32", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back when Date parsing throws (lines 64-65)", () => {
    const RealDate = global.Date;
    const marker = "BATCH32_CATCH";
    class MockDate extends RealDate {
      constructor(...args: ConstructorParameters<typeof RealDate>) {
        if (args[0] === marker) {
          throw new Error("forced batch32");
        }
        super(...args);
      }
    }
  Object.assign(MockDate, RealDate);
    vi.spyOn(global, "Date").mockImplementation(MockDate as unknown as typeof Date);

    mockUseAgentPeers.mockReturnValue({
      data: {
        peers: [
          { agent_id: "peer-b32", current_task: "sync", status: "continue", last_seen: marker },
        ],
        window_minutes: 60,
        timestamp: new RealDate().toISOString(),
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useAgentPeers>);

    render(<AgentPeersPanel />);
    expect(screen.getByText(marker.slice(0, 16))).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
