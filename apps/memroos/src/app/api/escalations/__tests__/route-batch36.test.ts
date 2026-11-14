// @vitest-environment node
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
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

vi.mock("@/lib/audit/sla", () => ({
  checkSlaBreaches: vi.fn(),
}));

const reviewerSession = {
  userId: "rev-b36",
  role: "reviewer" as const,
  email: "rev@example.com",
  displayName: "Rev",
  tenantId: "default-tenant",
};

describe("GET /api/escalations batch36 — slaRemainingMs map (63)", () => {
  beforeEach(() => {
    authenticateUser.mockResolvedValue(reviewerSession);
    testDb.exec("DELETE FROM hil_escalations");
    const deadline = new Date(Date.now() + 120_000).toISOString();
    testDb
      .prepare(
        `INSERT INTO hil_escalations (
           id, tenant_id, entity_type, entity_id, escalation_type, sla_seconds, sla_deadline,
           status, opened_by, created_at
         ) VALUES (?, 'default-tenant', 'task', 'task-b36', 'agent_escalate', 3600, ?, 'open', 'operator', ?)`,
      )
      .run(`hil-b36-${randomUUID().slice(0, 8)}`, deadline, new Date().toISOString());
  });

  it("includes slaRemainingMs on each escalation", async () => {
    const { GET } = await import("../route");
    const res = await GET(new NextRequest("http://localhost/api/escalations?status=open"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.escalations[0]?.slaRemainingMs).toBeGreaterThan(0);
  });
});
