/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/api-client", () => ({
  useAuditLog: vi.fn(),
}));

import { useAuditLog } from "@/lib/api-client";
import { AuditLogPanel } from "../audit-log-panel";

const mockUseAuditLog = useAuditLog as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AuditLogPanel batch32", () => {
  it("formats multi-day relative timestamps (line 47)", () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 86_400_000).toISOString();
    mockUseAuditLog.mockReturnValue({
      data: {
        entries: [
          {
            id: "audit-b32",
            actor: "operator",
            action: "settings.update",
            severity: "info",
            timestamp: fiveDaysAgo,
          },
        ],
      },
      isLoading: false,
    });
    render(<AuditLogPanel limit={5} />);
    expect(screen.getByText("5d ago")).toBeInTheDocument();
  });
});
