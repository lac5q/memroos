// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

let db: Database.Database;

afterEach(() => {
  db?.close();
  vi.restoreAllMocks();
});

describe("skill-audit-atomic batch20 — verification and wrapper paths", () => {
  it("insertAuditRow applies default actor and entity fields", async () => {
    db = new Database(":memory:");
    initSchema(db);
    const { commitAuditAtomic } = await import("../skill-audit-atomic");
    commitAuditAtomic(db, {
      actor: "operator-b20",
      eventType: "skill.test.primary-b20",
      entityType: "skill",
      entityId: "skill:paired-b20",
      metadata: { primary: true },
      body: (helpers) => {
        helpers.insertAuditRow({
          eventType: "skill.test.paired-b20",
          metadata: { paired: true },
        });
        return "ok";
      },
    });
    const paired = db
      .prepare(`SELECT actor_id, entity_id FROM audit_entries WHERE event_type = 'skill.test.paired-b20'`)
      .get() as { actor_id: string; entity_id: string };
    expect(paired.actor_id).toBe("operator-b20");
    expect(paired.entity_id).toBe("skill:paired-b20");
  });

  it("throws audit_verification_failed when verify select misses the row", async () => {
    db = new Database(":memory:");
    initSchema(db);
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      const stmt = originalPrepare(sql);
      if (sql.includes("SELECT id FROM audit_entries WHERE id = ?")) {
        return {
          ...stmt,
          get: () => undefined,
        } as ReturnType<typeof originalPrepare>;
      }
      return stmt;
    });
    const { commitAuditAtomic, AuditAtomicFailure } = await import("../skill-audit-atomic");
    expect(() =>
      commitAuditAtomic(db, {
        actor: "operator",
        eventType: "skill.test.verify-miss",
        entityType: "skill",
        entityId: "skill:verify-miss",
        metadata: {},
        body: () => "ok",
      }),
    ).toThrow(AuditAtomicFailure);
  });

  it("wraps non-AuditAtomicFailure errors as mutation_failed", async () => {
    db = new Database(":memory:");
    initSchema(db);
    const { commitAuditAtomic, AuditAtomicFailure } = await import("../skill-audit-atomic");
    expect(() =>
      commitAuditAtomic(db, {
        actor: "operator",
        eventType: "skill.test.body-throw",
        entityType: "skill",
        entityId: "skill:body-throw",
        metadata: {},
        body: () => {
          throw new Error("body blew up");
        },
      }),
    ).toThrow(AuditAtomicFailure);
  });
});
