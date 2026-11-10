/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  useOperationsNoc: vi.fn(),
}));

vi.mock("@/lib/api-client", () => api);

import { AgentActivityPanel } from "../index";

function nocPayload(sourceState: string, extra?: { isLoading?: boolean; isError?: boolean; agents?: unknown[] }) {
  return {
    data: {
      agentActivity: {
        sourceState,
        source: "sqlite://messages",
        observedAt: "2026-07-20T12:00:00.000Z",
        agents: extra?.agents ?? [{ agentId: "codex", messageCount: 2, sessionCount: 1, lastMessageAt: "2026-07-20T11:00:00.000Z" }],
        delegations: [],
      },
      sourceStates: { agentActivity: sourceState },
    },
    isLoading: extra?.isLoading ?? false,
    isError: extra?.isError ?? false,
  };
}

describe("AgentActivityPanel batch30 — agentActivityPanelSemantic branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps error, loading, live, window_empty, and stale_or_error source states (lines 94–98)", () => {
    api.useOperationsNoc.mockReturnValue(nocPayload("live", { isError: true }));
    const { rerender } = render(<AgentActivityPanel filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByTestId("agent-activity-panel").querySelector('[data-status-block="stale_or_error"]')).toBeTruthy();

    api.useOperationsNoc.mockReturnValue(nocPayload("live", { isLoading: true }));
    rerender(<AgentActivityPanel filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByText(/Loading agent activity/i)).toBeInTheDocument();

    api.useOperationsNoc.mockReturnValue(nocPayload("live", { agents: [{ agentId: "codex", messageCount: 3, sessionCount: 1, lastMessageAt: "2026-07-20T11:00:00.000Z" }] }));
    rerender(<AgentActivityPanel filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByText("codex")).toBeInTheDocument();

    api.useOperationsNoc.mockReturnValue(nocPayload("window_empty"));
    rerender(<AgentActivityPanel filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByTestId("agent-activity-panel").querySelector('[data-status-block="window_empty"]')).toBeTruthy();

    api.useOperationsNoc.mockReturnValue(nocPayload("stale_or_error"));
    rerender(<AgentActivityPanel filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByText(/stale or unavailable/i)).toBeInTheDocument();
  });
});
