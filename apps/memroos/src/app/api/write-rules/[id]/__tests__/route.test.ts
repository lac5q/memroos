// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";
import { createWriteRule } from "@/lib/write-rules";

const testDb = new Database(":memory:");
initSchema(testDb);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: vi.fn(() => ({ id: "agent-1" })),
}));

const { PATCH, DELETE } = await import("../route");

describe("/api/write-rules/[id]", () => {
  let ruleId: number;
  let caseId = 0;

  beforeEach(() => {
    caseId += 1;
    const space = createSpace(testDb, { tenantId: "default-tenant", name: `patch-space-${caseId}` });
    const rule = createWriteRule(testDb, {
      spaceId: space.id,
      dataType: "lesson",
      targetDocument: "lessons.md",
      actorId: "agent-1",
    });
    ruleId = rule.id;
  });

  it("PATCH returns 400 for invalid id", async () => {
    const req = new Request("http://localhost/api/write-rules/not-a-number", {
      method: "PATCH",
      headers: { authorization: "Bearer k", "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: 1, targetDocument: "new.md" }),
    });
    const res = await PATCH(req as never, { params: Promise.resolve({ id: "bad" }) });
    expect(res.status).toBe(400);
  });

  it("PATCH updates rule with optimistic concurrency", async () => {
    const req = new Request(`http://localhost/api/write-rules/${ruleId}`, {
      method: "PATCH",
      headers: { authorization: "Bearer k", "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: 1, targetDocument: "updated-lessons.md" }),
    });
    const res = await PATCH(req as never, { params: Promise.resolve({ id: String(ruleId) }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rule.targetDocument).toBe("updated-lessons.md");
    expect(body.rule.version).toBe(2);
  });

  it("DELETE removes rule when expectedVersion matches", async () => {
    const req = new Request(`http://localhost/api/write-rules/${ruleId}`, {
      method: "DELETE",
      headers: { authorization: "Bearer k", "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: 1 }),
    });
    const res = await DELETE(req as never, { params: Promise.resolve({ id: String(ruleId) }) });
    expect(res.status).toBe(200);
    const row = testDb.prepare("SELECT id FROM write_rules WHERE id = ?").get(ruleId);
    expect(row).toBeUndefined();
  });
});
