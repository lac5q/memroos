/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const apiMock = vi.hoisted(() => ({
  useAgents: vi.fn(),
  useEvalConfig: vi.fn(),
}));

vi.mock("@/lib/api-client", () => apiMock);
vi.mock("@/components/business-ops/kpi-timeline-panel", () => ({
  KpiTimelinePanel: () => <div data-testid="kpi-panel" />,
}));
vi.mock("@/components/business-ops/adapter-status-panel", () => ({
  AdapterStatusPanel: () => <div data-testid="adapter-panel" />,
}));

import BusinessOpsPage from "../page";

describe("BusinessOpsPage batch13b", () => {
  it("uses finance reconciliation copy when terminology is enabled", () => {
    apiMock.useAgents.mockReturnValue({ data: { agents: [] } });
    apiMock.useEvalConfig.mockReturnValue({
      data: {
        config: {
          finance: {
            enabled: true,
            transactionLabel: "trace",
            reconciliationLabel: "eval",
            exceptionLabel: "proposal",
          },
        },
      },
    });
    render(<BusinessOpsPage />);
    expect(screen.getByRole("heading", { name: "Finance Reconciliation" })).toBeInTheDocument();
    expect(screen.getByText(/per-agent reconciliation timeline/i)).toBeInTheDocument();
  });

  it("updates scope label when agent and date range change", () => {
    apiMock.useAgents.mockReturnValue({
      data: { agents: [{ id: "agent-1", name: "Agent One" }] },
    });
    apiMock.useEvalConfig.mockReturnValue({ data: null });
    render(<BusinessOpsPage />);
    expect(screen.getByText(/agentId=all/i)).toBeInTheDocument();
  });
});
