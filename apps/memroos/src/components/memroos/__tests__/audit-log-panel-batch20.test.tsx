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

describe("AuditLogPanel batch20", () => {
  it("renders default severity styling for unknown severity", () => {
    mockUseAuditLog.mockReturnValue({
      data: {
        entries: [
          {
            id: "e1",
            actor: "system",
            action: "custom.event",
            severity: "unknown-level",
            timestamp: new Date().toISOString(),
          },
        ],
      },
      isLoading: false,
    });
    render(<AuditLogPanel limit={10} />);
    expect(screen.getByText("custom.event")).toBeInTheDocument();
    expect(screen.getByText("system")).toBeInTheDocument();
  });

  it("falls back when timestamp parsing throws", () => {
    mockUseAuditLog.mockReturnValue({
      data: {
        entries: [
          {
            id: "e2",
            actor: "operator",
            action: "login",
            severity: "info",
            timestamp: "bad-ts-value",
          },
        ],
      },
      isLoading: false,
    });
    render(<AuditLogPanel />);
    expect(screen.getByText("bad-ts-value".slice(0, 16))).toBeInTheDocument();
  });

  it("shows loading spinner while fetching", () => {
    mockUseAuditLog.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = render(<AuditLogPanel />);
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });
});
