import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const api = vi.hoisted(() => ({
  useSecurityReport: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  useSecurityReport: api.useSecurityReport,
}));

import { SecurityOperationsPanel } from "../security-operations-panel";

describe("SecurityOperationsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading spinner", () => {
    api.useSecurityReport.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = render(<SecurityOperationsPanel />);
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("renders summary metrics and controls", () => {
    api.useSecurityReport.mockReturnValue({
      isLoading: false,
      data: {
        summary: {
          status: "watch",
          securityEvents: 3,
          blockedAttempts: 1,
          highSeverity: 2,
          lastEventAt: new Date().toISOString(),
        },
        timeline: [
          {
            id: "e1",
            actor: "ops@memroos.test.local",
            action: "login_blocked",
            target: "/api/auth/login",
            timestamp: new Date().toISOString(),
            detail: "Invalid credentials",
          },
        ],
        auditActivity: [],
        controls: [{ id: "c1", label: "JWT rotation", status: "enabled" }],
      },
    });

    render(<SecurityOperationsPanel />);
    expect(screen.getByText("Security Operations")).toBeInTheDocument();
    expect(screen.getByText("watch")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("JWT rotation")).toBeInTheDocument();
    expect(screen.getByText("Recent Security Events")).toBeInTheDocument();
  });
});
