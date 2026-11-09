import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const api = vi.hoisted(() => ({
  useSealAuditLog: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  useSealAuditLog: api.useSealAuditLog,
}));

import { AuditLogPanel } from "../audit-log-panel";

describe("AuditLogPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading spinner", () => {
    api.useSealAuditLog.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = render(<AuditLogPanel />);
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("shows empty state", () => {
    api.useSealAuditLog.mockReturnValue({ data: { entries: [] }, isLoading: false });
    render(<AuditLogPanel />);
    expect(screen.getByText("No audit events yet.")).toBeInTheDocument();
  });

  it("lists audit entries", () => {
    api.useSealAuditLog.mockReturnValue({
      isLoading: false,
      data: {
        entries: [
          {
            id: "a1",
            proposalId: "proposal-abcdef12",
            event: "approved",
            baselineW: 0.9,
            postApplyW: null,
            deltaComposite: 0.02,
            timestamp: "2026-07-01T00:00:00.000Z",
          },
        ],
      },
    });
    render(<AuditLogPanel />);
    expect(screen.getByText(/1 events/)).toBeInTheDocument();
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText(/^proposal$/)).toBeInTheDocument();
  });
});
