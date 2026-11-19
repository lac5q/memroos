/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const api = vi.hoisted(() => ({
  useSecurityReport: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  useSecurityReport: api.useSecurityReport,
}));

import { SecurityOperationsPanel } from "../security-operations-panel";

describe("SecurityOperationsPanel batch21", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders clear status and day-scale last event labels", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
    api.useSecurityReport.mockReturnValue({
      isLoading: false,
      data: {
        summary: {
          status: "clear",
          securityEvents: 0,
          blockedAttempts: 0,
          highSeverity: 0,
          lastEventAt: twoDaysAgo,
        },
        timeline: [],
        auditActivity: [],
        controls: [],
      },
    });

    render(<SecurityOperationsPanel />);
    expect(screen.getByText("clear")).toBeInTheDocument();
    expect(screen.getByText("2d ago")).toBeInTheDocument();
    expect(screen.getByText("No audit events yet.")).toBeInTheDocument();
  });

  it("falls back to audit activity header badge and invalid timestamps", () => {
    api.useSecurityReport.mockReturnValue({
      isLoading: false,
      data: {
        summary: {
          status: "watch",
          securityEvents: 0,
          blockedAttempts: 0,
          highSeverity: 0,
          lastAuditAt: "not-a-real-date",
        },
        timeline: [],
        auditActivity: [
          {
            id: "a2",
            actor: "reviewer",
            action: "export",
            target: "audit",
            timestamp: new Date(Date.now() - 45 * 60_000).toISOString(),
            detail: "CSV export",
          },
        ],
        controls: [],
      },
    });

    render(<SecurityOperationsPanel />);
    expect(screen.getByText("Recent Audit Activity")).toBeInTheDocument();
    expect(screen.getByText("no security events")).toBeInTheDocument();
    expect(screen.getByText("not-a-real-date".slice(0, 16))).toBeInTheDocument();
    expect(screen.getByText("CSV export")).toBeInTheDocument();
  });
});
