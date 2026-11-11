/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const api = vi.hoisted(() => ({
  useSecurityReport: vi.fn(),
  useOrchestrationHil: vi.fn(),
  useAuditLog: vi.fn(),
  useModelRoutingDashboard: vi.fn(),
  useModelUsage: vi.fn(),
  useDelegations: vi.fn(),
  useHiveFeed: vi.fn(),
  useSkills: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  useSecurityReport: api.useSecurityReport,
  useOrchestrationHil: api.useOrchestrationHil,
  useAuditLog: api.useAuditLog,
  useModelRoutingDashboard: api.useModelRoutingDashboard,
  useModelUsage: api.useModelUsage,
  useDelegations: api.useDelegations,
  useHiveFeed: api.useHiveFeed,
  useSkills: api.useSkills,
}));

vi.mock("@/components/shared/charts", () => ({
  Spark: () => <div data-testid="spark" />,
}));

import { GovernanceStrip } from "../governance-strip";
import { Cost, Savings, Waste } from "../savings-waste";

describe("Operations panels batch13b", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GovernanceStrip blocks workspace-scoped views", () => {
    api.useSecurityReport.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    api.useOrchestrationHil.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    api.useAuditLog.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    render(<GovernanceStrip filters={{ window: "24h", workspace: "local" }} />);
    expect(screen.getByText(/Workspace-scoped governance is unavailable/i)).toBeInTheDocument();
  });

  it("GovernanceStrip surfaces source failures and audit events", () => {
    api.useSecurityReport.mockReturnValue({
      data: { summary: { blockedAttempts: 2, securityEvents: 1, highSeverity: 0 } },
      isLoading: false,
      isError: false,
    });
    api.useOrchestrationHil.mockReturnValue({
      data: { decisions: [{ id: "d1" }] },
      isLoading: false,
      isError: false,
    });
    api.useAuditLog.mockReturnValue({
      data: {
        entries: [
          { timestamp: "2026-05-01T12:00:00.000Z", action: "policy.update", actor: "ops", target: "retention" },
        ],
      },
      isLoading: false,
      isError: false,
    });
    render(<GovernanceStrip filters={{ window: "7d", workspace: "all" }} />);
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/policy.update/i)).toBeInTheDocument();
  });

  it("GovernanceStrip shows stale messaging when any source errors", () => {
    api.useSecurityReport.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    api.useOrchestrationHil.mockReturnValue({ data: { decisions: [] }, isLoading: false, isError: false });
    api.useAuditLog.mockReturnValue({ data: { entries: [] }, isLoading: false, isError: false });
    render(<GovernanceStrip filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByText(/Governance data is stale or unavailable/i)).toBeInTheDocument();
  });

  it("Cost panel formats spend from routed events", () => {
    api.useModelRoutingDashboard.mockReturnValue({
      data: {
        events: [
          {
            agentId: "local-agent",
            model: "gpt-test",
            createdAt: new Date().toISOString(),
            estimatedCostUsd: 0.125,
            totalTokens: 900,
          },
        ],
      },
      isLoading: false,
      isError: false,
    });
    api.useModelUsage.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    api.useDelegations.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    api.useHiveFeed.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    api.useSkills.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    render(<Cost filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getAllByText(/\$0\.13|\$0\.125/).length).toBeGreaterThan(0);
  });

  it("Savings stays hidden without proven savings signals", () => {
    api.useModelRoutingDashboard.mockReturnValue({ data: { events: [] }, isLoading: false, isError: false });
    api.useModelUsage.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    render(<Savings filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByText(/No dollar-savings claim is rendered/i)).toBeInTheDocument();
  });

  it("Waste panel explains missing waste telemetry", () => {
    api.useModelRoutingDashboard.mockReturnValue({ data: { events: [] }, isLoading: false, isError: false });
    api.useModelUsage.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    api.useHiveFeed.mockReturnValue({ data: { actions: [] }, isLoading: false, isError: false });
    api.useDelegations.mockReturnValue({ data: { delegations: [] }, isLoading: false, isError: false });
    api.useSkills.mockReturnValue({
      data: { skillBudget: { duplicateSkills: [] }, coverageGaps: [] },
      isLoading: false,
      isError: false,
    });
    render(<Waste filters={{ window: "24h", workspace: "all" }} />);
    expect(screen.getByText("Retries")).toBeInTheDocument();
    expect(screen.getAllByText(/measured zero/i).length).toBeGreaterThan(0);
  });
});
