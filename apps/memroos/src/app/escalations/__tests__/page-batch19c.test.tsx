/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const api = vi.hoisted(() => ({
  useEscalations: vi.fn(),
  useResolveEscalation: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock("@/lib/api-client", () => ({
  useEscalations: api.useEscalations,
  useResolveEscalation: api.useResolveEscalation,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => api.searchParams,
}));

vi.mock("@/components/escalations/sla-countdown", () => ({
  SlaCountdown: () => <div data-testid="sla-countdown" />,
}));

import EscalationsPage from "../page";
import type { EscalationWithCountdown } from "@/lib/api-client";

function makeEscalation(id: string, index: number): EscalationWithCountdown {
  return {
    id,
    tenant_id: "tenant-1",
    entity_type: "agent",
    entity_id: `entity-${index}`,
    escalation_type: "agent_escalate",
    sla_seconds: 3600,
    sla_deadline: new Date(Date.now() + 60_000).toISOString(),
    status: "open",
    assigned_to: null,
    opened_by: "system",
    created_at: "not-a-valid-date",
    isOverdue: false,
    slaRemainingMs: 60_000,
  };
}

const mutate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  api.searchParams = new URLSearchParams();
  api.useResolveEscalation.mockReturnValue({
    mutate,
    isError: false,
    error: null,
  });
});

describe("EscalationsPage batch19c", () => {
  it("renders NOC drilldown banner and toggles show-all queue expansion", () => {
    api.searchParams = new URLSearchParams({
      from_window: "24h",
      from_workspace: "default",
      from_scope_note: "Scoped drilldown note",
    });
    const escalations = Array.from({ length: 12 }, (_, i) => makeEscalation(`esc-${i}`, i));
    api.useEscalations.mockReturnValue({
      data: { escalations, total: 12, timestamp: "2026-10-26T00:00:00.000Z" },
      isLoading: false,
      isError: false,
    });

    render(<EscalationsPage />);
    expect(screen.getByText(/Drilldown from Operations NOC/i)).toBeInTheDocument();
    expect(screen.getByText(/Scoped drilldown note/i)).toBeInTheDocument();
    expect(screen.getByText(/Showing 10 of 12/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Show up to 12/i }));
    expect(api.useEscalations).toHaveBeenLastCalledWith({ status: "open", limit: 200 });
    expect(screen.getByText(/Showing 12 of 12/i)).toBeInTheDocument();
  });

  it("cancel resolve modal without mutating and keeps invalid created_at timestamps", () => {
    api.useEscalations.mockReturnValue({
      data: { escalations: [makeEscalation("esc-cancel", 0)], timestamp: "2026-10-26T00:00:00.000Z" },
      isLoading: false,
      isError: false,
    });
    const spy = vi.spyOn(Date.prototype, "toLocaleString").mockImplementation(function (this: Date) {
      if (Number.isNaN(this.getTime())) throw new Error("invalid timestamp");
      return "2026-10-26";
    });

    render(<EscalationsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByText(/Created: not-a-valid-date/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mutate).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
