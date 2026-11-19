import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const api = vi.hoisted(() => ({
  useAuditEntries: vi.fn(),
  useAuditExportUrl: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  useAuditEntries: api.useAuditEntries,
  useAuditExportUrl: api.useAuditExportUrl,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("from_window=24h&from_workspace=all"),
}));

import AuditPage from "../page";

describe("AuditPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.useAuditExportUrl.mockImplementation((_filter, format) => `/api/audit/export.${format}`);
    api.useAuditEntries.mockReturnValue({
      data: {
        entries: [
          {
            id: "ae-1",
            created_at: "2026-07-01T12:00:00.000Z",
            actor_id: "operator",
            event_type: "login",
            entity_type: "user",
            entity_id: "user-1",
            reason: "sign-in",
          },
        ],
        nextCursor: null,
      },
      isLoading: false,
      isError: false,
      isFetching: false,
    });
  });

  it("renders audit log with drilldown banner and row", () => {
    render(<AuditPage />);

    expect(screen.getByText("Audit Log")).toBeInTheDocument();
    expect(screen.getByText(/Drilldown from Operations NOC/i)).toBeInTheDocument();
    expect(screen.getByText("operator")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Export NDJSON" })).toHaveAttribute(
      "href",
      "/api/audit/export.ndjson",
    );
  });

  it("shows loading and error states", () => {
    api.useAuditEntries.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      isFetching: false,
    });
    render(<AuditPage />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();

    api.useAuditEntries.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
    });
    render(<AuditPage />);
    expect(screen.getByText(/Failed to load audit entries/i)).toBeInTheDocument();
  });

  it("applies filters and exposes CSV export links", () => {
    api.useAuditEntries.mockReturnValue({
      data: {
        entries: [{ id: "ae-1", created_at: "2026-07-01T12:00:00.000Z", actor_id: "operator", event_type: "login", entity_type: "user", entity_id: "u1", reason: "sign-in" }],
        nextCursor: "cursor-2",
      },
      isLoading: false,
      isError: false,
      isFetching: false,
    });

    render(<AuditPage />);
    fireEvent.change(screen.getByPlaceholderText("agent-id"), { target: { value: "agent-42" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Filters" }));
    expect(api.useAuditExportUrl).toHaveBeenCalledWith(expect.objectContaining({ agentId: "agent-42" }), "ndjson");
    expect(screen.getByRole("link", { name: "Export CSV" })).toHaveAttribute("href", "/api/audit/export.csv");
    expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
  });

  it("truncates long reasons in the audit table", () => {
    api.useAuditEntries.mockReturnValue({
      data: {
        entries: [{
          id: "ae-long",
          created_at: "not-a-date",
          actor_id: "operator",
          event_type: "login",
          entity_type: "user",
          entity_id: "user-1",
          reason: "x".repeat(120),
        }],
        nextCursor: null,
      },
      isLoading: false,
      isError: false,
      isFetching: false,
    });
    render(<AuditPage />);
    expect(screen.getByText(/x{80}…/)).toBeInTheDocument();
  });

  it("shows empty state when no entries", () => {
    api.useAuditEntries.mockReturnValue({
      data: { entries: [], nextCursor: null },
      isLoading: false,
      isError: false,
      isFetching: false,
    });

    render(<AuditPage />);
    expect(screen.getByText(/No audit entries found/i)).toBeInTheDocument();
  });
});
