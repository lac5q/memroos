/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PaperclipFleetPanel } from "../paperclip-fleet-panel";
import type { PaperclipFleetResponse } from "@/types";

const fleetFixture: PaperclipFleetResponse = {
  summary: {
    fleetStatus: "active",
    totalAgents: 1,
    activeAgents: 1,
    activeTasks: 0,
    pausedRecoveries: 0,
    autonomyMix: { Interactive: 1, Autonomous: 0, Continuous: 0, Hybrid: 0 },
    lastHeartbeat: new Date(Date.now() - 7200_000).toISOString(),
  },
  agents: [
    {
      id: "agent-batch17",
      name: "Batch17 Agent",
      status: "active",
      autonomyMode: "Hybrid",
      activeTask: "idle",
      lastHeartbeat: new Date(Date.now() - 7200_000).toISOString(),
    },
  ],
  operations: [],
  timestamp: new Date().toISOString(),
};

describe("PaperclipFleetPanel batch17", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("formats hour-scale heartbeat labels", () => {
    render(<PaperclipFleetPanel fleet={fleetFixture} isLoading={false} />);
    expect(screen.getByText(/2h ago/)).toBeInTheDocument();
  });

  it("resets dispatch status when the operator edits the task summary", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: "batch17 dispatch rejected" }),
    } as Response);

    render(<PaperclipFleetPanel fleet={fleetFixture} isLoading={false} />);
    const input = screen.getByPlaceholderText(/Task summary to dispatch/i);
    fireEvent.change(input, { target: { value: "batch17 task one" } });
    fireEvent.click(screen.getByRole("button", { name: "Dispatch task" }));

    await waitFor(() => {
      expect(screen.getByText(/batch17 dispatch rejected/)).toBeInTheDocument();
    });

    fireEvent.change(input, { target: { value: "batch17 task two" } });
    expect(screen.queryByText(/batch17 dispatch rejected/)).not.toBeInTheDocument();
  });

  it("surfaces network failures from dispatch POST", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("batch17 paperclip network down"));

    render(<PaperclipFleetPanel fleet={fleetFixture} isLoading={false} />);
    fireEvent.change(screen.getByPlaceholderText(/Task summary to dispatch/i), {
      target: { value: "batch17 offline dispatch" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Dispatch task" }));

    await waitFor(() => {
      expect(screen.getByText(/batch17 paperclip network down/)).toBeInTheDocument();
    });
  });
});
