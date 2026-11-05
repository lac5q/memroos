// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const authenticateUser = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
}));

vi.mock("@/lib/export/dsar-export", () => ({
  deleteDsarUser: vi.fn(() => ({
    auditRowsPreserved: true,
    tombstones: [{ table: "users", id: "user-123" }],
  })),
}));

vi.mock("@/lib/audit/knowledge-chain", () => ({
  verifyKnowledgeAuditChain: vi.fn(() => ({ valid: true, checked: 1 })),
}));

const { POST } = await import("../route");

describe("POST /api/dsar/delete", () => {
  beforeEach(() => {
    authenticateUser.mockReset();
  });

  it("rejects non-admin callers", async () => {
    authenticateUser.mockResolvedValueOnce({
      userId: "op",
      role: "operator",
      email: "op@example.com",
      displayName: "Op",
      tenantId: "default-tenant",
    });
    const res = await POST(
      new Request("http://localhost/api/dsar/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "user-123" }),
      }) as never
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid JSON", async () => {
    authenticateUser.mockResolvedValueOnce({
      userId: "admin",
      role: "admin",
      email: "admin@example.com",
      displayName: "Admin",
      tenantId: "default-tenant",
    });
    const res = await POST(
      new Request("http://localhost/api/dsar/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }) as never
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when userId validation fails", async () => {
    authenticateUser.mockResolvedValueOnce({
      userId: "admin",
      role: "admin",
      email: "admin@example.com",
      displayName: "Admin",
      tenantId: "default-tenant",
    });
    const res = await POST(
      new Request("http://localhost/api/dsar/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "" }),
      }) as never
    );
    expect(res.status).toBe(400);
  });

  it("tombstones user for admin", async () => {
    authenticateUser.mockResolvedValueOnce({
      userId: "admin",
      role: "admin",
      email: "admin@example.com",
      displayName: "Admin",
      tenantId: "default-tenant",
    });
    const res = await POST(
      new Request("http://localhost/api/dsar/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "user-123" }),
      }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.knowledgeChainValid).toBe(true);
  });
});
