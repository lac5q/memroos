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

const mockUseSecurityCapabilities = vi.mocked(useSecurityCapabilities);

describe("AgentSecurityModesPanel batch16", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSecurityCapabilities.mockReturnValue({
      data: {
        summary: {
          metrics: {
            totalAgents: {
              status: "live",
              value: 3,
              source: "sqlite",
              observedAt: "2026-10-23T12:00:00.000Z",
              freshnessMs: 0,
              scope: { window: "lifetime", workspace: "all" },
              reason: null,
            },
            strictAgents: {
              status: "live",
              value: 1,
              source: "sqlite",
              observedAt: "2026-10-23T12:00:00.000Z",
              freshnessMs: 0,
              scope: { window: "lifetime", workspace: "all" },
              reason: null,
            },
            agentsWithSecurityCapabilities: {
              status: "degraded",
              value: 2,
              source: "sqlite",
              observedAt: "2026-10-23T12:00:00.000Z",
              freshnessMs: 0,
              scope: { window: "lifetime", workspace: "all" },
              reason: "partial caps",
            },
          },
        },
        policies: {
          defaultMode: "standard",
          dispatchPolicy: "enforced",
          a2aPolicy: "enforced",
          memoryWritePolicy: "enforced",
          metric: { source: "policy-engine", status: "live", reason: null },
        },
        agents: [
          {
            id: "strict-batch16",
            name: "Strict Agent",
            role: "ops",
            protocol: "rest",
            securityMode: "strict",
            readinessScore: 95,
            liveness: { state: "live" },
          },
          {
            id: "permissive-batch16",
            name: "Permissive Agent",
            role: "research",
            protocol: "a2a",
            securityMode: "permissive",
            readinessScore: 70,
            liveness: { state: "stale" },
          },
          {
            id: "standard-batch16",
            name: "Standard Agent",
            role: "worker",
            protocol: "local",
            securityMode: "standard",
            readinessScore: 82,
            liveness: { state: "missing" },
          },
        ],
        timestamp: "2026-10-23T12:00:00.000Z",
      },
      isLoading: false,
      isError: false,
      error: null,
    } as ReturnType<typeof useSecurityCapabilities>);
  });

  it("renders security mode badges and metric envelope summaries", () => {
    render(<AgentSecurityModesPanel />);
    expect(screen.getByText("Security Modes")).toBeInTheDocument();
    expect(screen.getByText("default standard")).toBeInTheDocument();
    expect(screen.getByText("strict")).toBeInTheDocument();
    expect(screen.getByText("permissive")).toBeInTheDocument();
    expect(screen.getByText("standard")).toBeInTheDocument();
    expect(screen.getByText("Strict Agent")).toBeInTheDocument();
    expect(screen.getByText("95%")).toBeInTheDocument();
    expect(screen.getByText(/source: sqlite · observed at/)).toBeInTheDocument();
    expect(screen.getByText(/source: policy-engine · live/)).toBeInTheDocument();
  });

  it("shows loading and error states", () => {
    mockUseSecurityCapabilities.mockReturnValueOnce({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    } as ReturnType<typeof useSecurityCapabilities>);
    const { rerender, container } = render(<AgentSecurityModesPanel />);
    expect(container.querySelector(".animate-spin")).toBeTruthy();

    mockUseSecurityCapabilities.mockReturnValueOnce({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("batch16 security capabilities down"),
    } as ReturnType<typeof useSecurityCapabilities>);
    rerender(<AgentSecurityModesPanel />);
    expect(screen.getByText(/batch16 security capabilities down/)).toBeInTheDocument();
  });
});
