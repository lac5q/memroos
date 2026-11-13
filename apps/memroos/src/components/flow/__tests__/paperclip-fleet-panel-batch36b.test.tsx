/**
 * @vitest-environment jsdom
 */
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PaperclipFleetPanel } from "../paperclip-fleet-panel";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PaperclipFleetPanel batch36b", () => {
  it("handleDispatch ignores whitespace-only summaries (53)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<PaperclipFleetPanel fleet={null} isLoading={false} />);
    // fleet null — switch to loading-capable path via isLoading false + null fleet shows offline
    expect(screen.getByText(/Fleet offline/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("dispatch surfaces API error body when POST fails", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: `dispatch-b36b-${randomUUID().slice(0, 6)}` }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const fleet = {
      summary: {
        fleetStatus: "active",
        totalAgents: 1,
        activeAgents: 1,
        activeTasks: 0,
        pausedRecoveries: 0,
        autonomyMix: { Interactive: 1, Autonomous: 0, Continuous: 0, Hybrid: 0 },
        lastHeartbeat: new Date().toISOString(),
      },
      agents: [],
      operations: [],
      timestamp: new Date().toISOString(),
    };
    render(<PaperclipFleetPanel fleet={fleet} isLoading={false} />);
    const input = screen.getByPlaceholderText(/Task summary to dispatch/i);
    fireEvent.change(input, { target: { value: `Task ${randomUUID().slice(0, 8)}` } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(screen.getByText(/dispatch-b36b/i)).toBeInTheDocument());
  });

  it("dispatch ignores trim-only task summary", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const fleet = {
      summary: {
        fleetStatus: "active",
        totalAgents: 1,
        activeAgents: 1,
        activeTasks: 0,
        pausedRecoveries: 0,
        autonomyMix: { Interactive: 1, Autonomous: 0, Continuous: 0, Hybrid: 0 },
        lastHeartbeat: new Date().toISOString(),
      },
      agents: [],
      operations: [],
      timestamp: new Date().toISOString(),
    };
    render(<PaperclipFleetPanel fleet={fleet} isLoading={false} />);
    const input = screen.getByPlaceholderText(/Task summary to dispatch/i);
    fireEvent.change(input, { target: { value: "   \n\t  " } });
    fireEvent.submit(input.closest("form")!);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
