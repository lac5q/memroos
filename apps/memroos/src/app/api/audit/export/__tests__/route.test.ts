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

const { GET } = await import("../route");

describe("GET /api/audit/export", () => {
  beforeEach(() => {
    authenticateUser.mockReset();
  });

  it("returns 403 when unauthenticated", async () => {
    authenticateUser.mockResolvedValueOnce(null);
    expect((await GET(new Request("http://localhost/api/audit/export") as never)).status).toBe(403);
  });

  it("returns 403 for reviewer role", async () => {
    authenticateUser.mockResolvedValueOnce({
      userId: "r1",
      role: "reviewer",
      email: "r@example.com",
      displayName: "R",
      tenantId: "default-tenant",
    });
    expect((await GET(new Request("http://localhost/api/audit/export") as never)).status).toBe(403);
  });

  it("streams NDJSON audit entries for operators", async () => {
    authenticateUser.mockResolvedValueOnce({
      userId: "op",
      role: "operator",
      email: "op@example.com",
      displayName: "Op",
      tenantId: "default-tenant",
    });
    testDb.prepare(
      `INSERT INTO audit_entries (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(`a1-${Date.now()}`, "default-tenant", "agent-1", "operator", "memory.read", "memory", "m1", new Date().toISOString());

    const res = await GET(new Request("http://localhost/api/audit/export") as never);
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines.some((line) => JSON.parse(line).id.startsWith("a1-"))).toBe(true);
  });

  it("streams CSV with escaped values", async () => {
    authenticateUser.mockResolvedValueOnce({
      userId: "op",
      role: "operator",
      email: "op@example.com",
      displayName: "Op",
      tenantId: "default-tenant",
    });
    testDb.prepare(
      `INSERT INTO audit_entries (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(`a2-${Date.now()}`, "default-tenant", "agent-1", "operator", "memory.read", "memory", "m2", 'say "hello", world', new Date().toISOString());

    const res = await GET(new Request("http://localhost/api/audit/export?format=csv&eventType=memory.read,memory.write") as never);
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv.split("\n")[0]).toContain("id,tenant_id");
    expect(csv).toContain('"say ""hello"", world"');
  });
});
