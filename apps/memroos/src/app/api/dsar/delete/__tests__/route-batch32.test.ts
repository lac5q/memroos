// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const authenticateUser = vi.hoisted(() => vi.fn());
const requireRole = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
}));

vi.mock("@/lib/auth/middleware-roles", () => ({
  requireRole: (...args: unknown[]) => requireRole(...args),
}));

vi.mock("@/lib/export/dsar-export", () => ({
  deleteDsarUser: vi.fn(),
}));

vi.mock("@/lib/audit/knowledge-chain", () => ({
  verifyKnowledgeAuditChain: vi.fn(() => ({ valid: true, checked: 0 })),
}));

const { POST } = await import("../route");

describe("POST /api/dsar/delete batch32", () => {
  beforeEach(() => {
    authenticateUser.mockReset();
    requireRole.mockReset();
  });

  it("returns 401 when session is missing after role passes (line 29)", async () => {
    authenticateUser.mockResolvedValue(null);
    requireRole.mockReturnValue(null);
    const res = await POST(
      new Request("http://localhost/api/dsar/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "user-b32" }),
      }) as never,
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "authentication required" });
  });
});
