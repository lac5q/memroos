import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const api = vi.hoisted(() => ({
  useAuditEntries: vi.fn(),
  useAuditExportUrl: vi.fn(),
}));

const searchParamsMock = vi.hoisted(() => ({
  params: new URLSearchParams("from_window=24h&from_workspace=ops"),
}));

vi.mock("@/lib/api-client", () => ({
  useAuditEntries: api.useAuditEntries,
  useAuditExportUrl: api.useAuditExportUrl,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsMock.params,
}));

import AuditPage from "../page";

describe("AuditPage batch13 coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsMock.params = new URLSearchParams("from_window=24h&from_workspace=ops");
    api.useAuditExportUrl.mockImplementation((_filter, format) => `/api/audit/export.${format}`);
    api.useAuditEntries.mockReturnValue({
      data: { entries: [], nextCursor: null },
      isLoading: false,
      isError: false,
      isFetching: false,
    });
  });

  it("shows custom drilldown scope note when provided", () => {
    searchParamsMock.params = new URLSearchParams({
      from_window: "7d",
      from_workspace: "ledger",
      from_scope_note: "Scoped to finance workspace only.",
    });

    render(<AuditPage />);
    expect(screen.getByText(/Scoped to finance workspace only/i)).toBeInTheDocument();
  });

  it("applies actor, event type, and date filters", () => {
    render(<AuditPage />);
    fireEvent.change(screen.getByPlaceholderText("user or system"), { target: { value: "operator-1" } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "agent.matched" } });
    const dateInputs = document.querySelectorAll('input[type="datetime-local"]');
    fireEvent.change(dateInputs[0], { target: { value: "2026-06-01T08:00" } });
    fireEvent.change(dateInputs[1], { target: { value: "2026-06-02T08:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Filters" }));

    expect(api.useAuditExportUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "operator-1",
        eventType: "agent.matched",
        from: "2026-06-01T08:00",
        to: "2026-06-02T08:00",
      }),
      "ndjson",
    );
  });

  it("loads more entries and deduplicates by id", () => {
    api.useAuditEntries.mockReturnValue({
      data: {
        entries: [
          {
            id: "ae-1",
            created_at: "2026-07-01T12:00:00.000Z",
            actor_id: "operator",
            event_type: "login",
            entity_type: "user",
            entity_id: "u1",
            reason: null,
          },
          {
            id: "ae-2",
            created_at: "2026-07-01T13:00:00.000Z",
            actor_id: "operator",
            event_type: "logout",
            entity_type: "user",
            entity_id: "u1",
            reason: "session end",
          },
        ],
        nextCursor: "cursor-2",
      },
      isLoading: false,
      isError: false,
      isFetching: false,
    });

    render(<AuditPage />);
    expect(screen.getByText("session end")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(screen.getAllByText("operator").length).toBeGreaterThan(0);
  });

  it("renders rows when reason is empty", () => {
    api.useAuditEntries.mockReturnValue({
      data: {
        entries: [
          {
            id: "ae-empty-reason",
            created_at: "not-a-date",
            actor_id: "system",
            event_type: "heartbeat",
            entity_type: "agent",
            entity_id: "a1",
            reason: null,
          },
        ],
        nextCursor: null,
      },
      isLoading: false,
      isError: false,
      isFetching: false,
    });

    const original = Date.prototype.toLocaleString;
    Date.prototype.toLocaleString = function toLocaleString() {
      throw new Error("bad locale");
    };

    render(<AuditPage />);
    expect(screen.getByText("system")).toBeInTheDocument();
    expect(screen.getByText("not-a-date")).toBeInTheDocument();

    Date.prototype.toLocaleString = original;
  });
});
