import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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
