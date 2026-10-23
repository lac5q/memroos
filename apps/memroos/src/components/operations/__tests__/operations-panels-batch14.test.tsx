/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const api = vi.hoisted(() => ({
  useModelRoutingDashboard: vi.fn(),
  useModelUsage: vi.fn(),
  useDelegations: vi.fn(),
  useHiveFeed: vi.fn(),
  useSkills: vi.fn(),
  useOperationsNoc: vi.fn(),
  useAgentWorkload: vi.fn(),
  useAgents: vi.fn(),
  useAgentPeers: vi.fn(),
  useTimeSeries: vi.fn(),
  useMemoryStats: vi.fn(),
  useEscalations: vi.fn(),
  useSecurityReport: vi.fn(),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, ...api };
});

vi.mock("@/components/shared/charts", () => ({
  Spark: () => <div data-testid="spark" />,
}));

import { Cost, Savings } from "../savings-waste";
import { NocHeader } from "../noc-header";
import { AgentWorkload } from "../agent-workload";
import { OperationsNoc } from "../index";

describe("Operations panels batch14", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.useModelRoutingDashboard.mockReturnValue({ data: { events: [] }, isLoading: false, isError: false });
    api.useModelUsage.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    api.useDelegations.mockReturnValue({ data: { delegations: [] }, isLoading: false, isError: false });
    api.useHiveFeed.mockReturnValue({ data: { actions: [] }, isLoading: false, isError: false });
    api.useSkills.mockReturnValue({
      data: { skillBudget: { duplicateSkills: [] }, coverageGaps: [] },
      isLoading: false,
      isError: false,
    });
    api.useOperationsNoc.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    api.useAgentWorkload.mockReturnValue({ data: { agents: [] }, isLoading: false, isError: false });
    api.useAgents.mockReturnValue({ data: { agents: [] }, isLoading: false, isError: false });
    api.useAgentPeers.mockReturnValue({ data: { peers: [] }, isLoading: false, isError: false });
    api.useTimeSeries.mockReturnValue({ data: { points: [] }, isLoading: false, error: null });
    api.useMemoryStats.mockReturnValue({ data: { sources: [] }, isLoading: false, isError: false });
    api.useEscalations.mockReturnValue({ data: { escalations: [] }, isLoading: false, isError: false });
    api.useSecurityReport.mockReturnValue({ data: { summary: {} }, isLoading: false, isError: false });
  });

  it("Savings shows loading sparkline copy", () => {
    render(<Savings filters={{ window: "24h", workspace: "local" }} />);
    expect(screen.getByText(/loading \/api\/model-usage/i)).toBeInTheDocument();
  });

  it("Cost filters remote workspace events", () => {
    api.useModelRoutingDashboard.mockReturnValue({
      data: {
        events: [
          {
            agentId: "remote-agent",
            model: "gpt-test",
            createdAt: new Date().toISOString(),
            estimatedCostUsd: 0.5,
            totalTokens: 100,
          },
        ],
      },
      isLoading: false,
      isError: false,
    });
    render(<Cost filters={{ window: "24h", workspace: "remote" }} />);
    expect(document.body.textContent).toContain("remote");
  });

  it("NocHeader renders workspace selectors", () => {
    render(
      <NocHeader
        filters={{ window: "24h", workspace: "all" }}
        onFiltersChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Operations · live telemetry/i)).toBeInTheDocument();
  });

  it("AgentWorkload renders empty roster copy", () => {
    render(<AgentWorkload filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByText(/Agent workload/i)).toBeInTheDocument();
  });

  it("OperationsNoc shell renders header region", () => {
    render(<OperationsNoc />);
    expect(screen.getByText(/Operations · live telemetry/i)).toBeInTheDocument();
  });
});
