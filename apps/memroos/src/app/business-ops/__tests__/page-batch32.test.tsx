/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  useAgents: vi.fn(),
  useEvalConfig: vi.fn(),
}));

vi.mock("@/lib/api-client", () => apiMock);
vi.mock("@/components/business-ops/kpi-timeline-panel", () => ({
  KpiTimelinePanel: () => <div data-testid="kpi-panel-b32" />,
}));
vi.mock("@/components/business-ops/adapter-status-panel", () => ({
  AdapterStatusPanel: () => <div data-testid="adapter-panel-b32" />,
}));

import BusinessOpsPage from "../page";

describe("BusinessOpsPage batch32", () => {
  it("updates date range via select onChange (line 73)", () => {
    apiMock.useAgents.mockReturnValue({ data: { agents: [] } });
    apiMock.useEvalConfig.mockReturnValue({ data: null });

    render(<BusinessOpsPage />);
    const select = screen.getByLabelText(/Date range/i);
    fireEvent.change(select, { target: { value: "7" } });
    expect(select).toHaveValue("7");
    expect(document.querySelector('[data-business-ops-date-option="7"]')).toBeTruthy();
  });
});
