/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/api-client", () => ({
  useSecurityCapabilities: vi.fn(),
}));

import { useSecurityCapabilities } from "@/lib/api-client";
import { AgentSecurityModesPanel } from "../agent-security-modes-panel";

const mockHook = useSecurityCapabilities as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AgentSecurityModesPanel batch20", () => {
  it("surfaces fetch errors with message text", () => {
    mockHook.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error("capabilities offline"),
      data: undefined,
    });
    render(<AgentSecurityModesPanel />);
    expect(screen.getByText(/Failed to load/i)).toBeInTheDocument();
    expect(screen.getByText(/capabilities offline/i)).toBeInTheDocument();
  });

  it("renders default policy mode and agent strict badge", () => {
    mockHook.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        policies: { defaultMode: "balanced" },
        summary: {
          metrics: {
            totalAgents: {
              status: "live",
              value: 3,
              source: "agents",
              observedAt: "2026-10-26T00:00:00.000Z",
              freshnessMs: 1000,
              scope: { window: "lifetime", workspace: "all" },
              reason: null,
            },
            strictAgents: {
              status: "zero",
              value: 0,
              source: "agents",
              observedAt: "2026-10-26T00:00:00.000Z",
              freshnessMs: 1000,
              scope: { window: "lifetime", workspace: "all" },
              reason: null,
            },
            agentsWithSecurityCapabilities: {
              status: "live",
              value: 1,
              source: "agents",
              observedAt: "2026-10-26T00:00:00.000Z",
              freshnessMs: 1000,
              scope: { window: "lifetime", workspace: "all" },
              reason: null,
            },
          },
        },
        agents: [
          {
            id: "codex-cli",
            name: "Codex CLI",
            role: "worker",
            protocol: "rest",
            securityMode: "strict",
            readinessScore: 92,
            liveness: { state: "online" },
          },
        ],
      },
    });
    render(<AgentSecurityModesPanel />);
    expect(screen.getByText(/default balanced/i)).toBeInTheDocument();
    expect(screen.getByText("strict")).toBeInTheDocument();
  });
});
