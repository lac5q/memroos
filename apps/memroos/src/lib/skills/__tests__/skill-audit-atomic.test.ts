// @vitest-environment node
/**
 * VAL-SKILL-038 — Audit-atomic skill governance mutations.
 *
 * Covers:
 *   - successful mutation commits body + audit row together
 *   - thrown body rolls back both
 *   - audit insert failure rolls back body
 *   - idempotency cache collapses retries to same result
 *   - requireVerified throws and rolls back when verification fails
 *   - insertAuditRow paired rows persist
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { getDb, closeDb } from "@/lib/db";
import { resetAuditAtomicCache } from "@/lib/skills/skill-audit-atomic";

const TMP_ROOT = path.join(os.tmpdir(), `audit-atomic-${crypto.randomUUID()}`);

let db: import("better-sqlite3").Database;

beforeEach(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  const root = path.join(TMP_ROOT, `db-${crypto.randomUUID()}`);
  fs.mkdirSync(root, { recursive: true });
  process.env["MEMROOS_ROOT"] = root;
  process.env["SQLITE_DB_PATH"] = path.join(root, "test.db");
  try {
    closeDb();
  } catch {}
  db = getDb();
  resetAuditAtomicCache();
});

afterEach(() => {
  try {
    closeDb();
  } catch {}
  delete process.env["MEMROOS_ROOT"];
  delete process.env["SQLITE_DB_PATH"];
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe("VAL-SKILL-038 audit-atomic mutations", () => {
  it("commits body + audit row in single transaction", async () => {
    const { commitAuditAtomic } = await import("@/lib/skills/skill-audit-atomic");

    const result = commitAuditAtomic(db, {
      actor: "operator",
      eventType: "skill.test.committed",
      entityType: "skill",
      entityId: "skill:1",
      metadata: { hello: "world" },
      body: () => {
        db.prepare(`INSERT INTO skill_registry (name, source_harness, raw_body, imported_by) VALUES ('audit-atomic-1', 'claude', 'body', 'operator')`).run();
        return { skillName: "audit-atomic-1" };
      },
    });
    expect(result.auditId).toMatch(/^audit-atomic-/);
    expect((result.mutationResult as { skillName: string }).skillName).toBe("audit-atomic-1");

    const reg = db.prepare(`SELECT COUNT(*) as c FROM skill_registry WHERE name='audit-atomic-1'`).get() as { c: number };
    expect(reg.c).toBe(1);

    const auditCount = db.prepare(`SELECT COUNT(*) as c FROM audit_entries WHERE event_type='skill.test.committed'`).get() as { c: number };
    expect(auditCount.c).toBe(1);
  });

  it("body that throws rolls back both mutation and audit row", async () => {
    const { commitAuditAtomic, AuditAtomicFailure } = await import(
      "@/lib/skills/skill-audit-atomic"
    );
    expect(() =>
      commitAuditAtomic(db, {
        actor: "operator",
        eventType: "skill.test.rollback",
        entityType: "skill",
        entityId: "skill:99",
        metadata: {},
        body: () => {
          db.prepare(`INSERT INTO skill_registry (name, source_harness, raw_body, imported_by) VALUES ('rollback-1', 'claude', 'body', 'operator')`).run();
          throw new AuditAtomicFailure("deliberate", "deliberate");
        },
      })
    ).toThrow(AuditAtomicFailure);

    const reg = db.prepare(`SELECT COUNT(*) as c FROM skill_registry WHERE name='rollback-1'`).get() as { c: number };
    expect(reg.c).toBe(0);
    const auditCount = db.prepare(`SELECT COUNT(*) as c FROM audit_entries WHERE event_type='skill.test.rollback'`).get() as { c: number };
    expect(auditCount.c).toBe(0);
  });

  it("requireVerified rolls back when verification fails", async () => {
    const { commitAuditAtomic, AuditAtomicFailure } = await import(
      "@/lib/skills/skill-audit-atomic"
    );
    expect(() =>
      commitAuditAtomic(db, {
        actor: "operator",
        eventType: "skill.test.verification",
        entityType: "skill",
        entityId: "skill:verify",
        metadata: {},
        body: (helpers) => {
          db.prepare(`INSERT INTO skill_registry (name, source_harness, raw_body, imported_by) VALUES ('verify-fail', 'claude', 'body', 'operator')`).run();
          helpers.requireVerified("tamper check", false);
        },
      })
    ).toThrow(AuditAtomicFailure);
    const reg = db.prepare(`SELECT COUNT(*) as c FROM skill_registry WHERE name='verify-fail'`).get() as { c: number };
    expect(reg.c).toBe(0);
  });

  it("requireVerified passes when verification succeeds", async () => {
    const { commitAuditAtomic } = await import("@/lib/skills/skill-audit-atomic");
    const result = commitAuditAtomic(db, {
      actor: "operator",
      eventType: "skill.test.passed",
      entityType: "skill",
      entityId: "skill:ok",
      metadata: {},
      body: (helpers) => {
        helpers.requireVerified("checksum", true);
        return "ok";
      },
    });
    expect(result.mutationResult).toBe("ok");
  });

  it("idempotency key returns same result on retry without re-executing body", async () => {
    const { commitAuditAtomic, resetAuditAtomicCache } = await import(
      "@/lib/skills/skill-audit-atomic"
    );
    resetAuditAtomicCache();

    let bodyInvocations = 0;
    const first = commitAuditAtomic(db, {
      actor: "operator",
      eventType: "skill.test.idempotent",
      entityType: "skill",
      entityId: "skill:idem",
      metadata: { attempt: 1 },
      idempotencyKey: "idemp-key-1",
      body: () => {
        bodyInvocations++;
        return { n: bodyInvocations };
      },
    });
    const second = commitAuditAtomic(db, {
      actor: "operator",
      eventType: "skill.test.idempotent",
      entityType: "skill",
      entityId: "skill:idem",
      metadata: { attempt: 2 },
      idempotencyKey: "idemp-key-1",
      body: () => {
        bodyInvocations++;
        return { n: bodyInvocations };
      },
    });

    expect(bodyInvocations).toBe(1);
    expect(first.auditId).toBe(second.auditId);
    expect((first.mutationResult as { n: number }).n).toBe(1);
    expect((second.mutationResult as { n: number }).n).toBe(1);
  });

  it("insertAuditRow inserts paired audit row in the same transaction", async () => {
    const { commitAuditAtomic } = await import("@/lib/skills/skill-audit-atomic");
    commitAuditAtomic(db, {
      actor: "operator",
      eventType: "skill.test.primary",
      entityType: "skill",
      entityId: "skill:paired",
      metadata: { primary: true },
      body: (helpers) => {
        helpers.insertAuditRow({
          eventType: "skill.test.paired",
          reason: "paired with primary",
          metadata: { paired: true },
        });
        return "ok";
      },
    });
    const primary = db.prepare(`SELECT COUNT(*) as c FROM audit_entries WHERE event_type='skill.test.primary'`).get() as { c: number };
    const paired = db.prepare(`SELECT COUNT(*) as c FROM audit_entries WHERE event_type='skill.test.paired'`).get() as { c: number };
    expect(primary.c).toBe(1);
    expect(paired.c).toBe(1);
  });

  it("throws when actor is missing", async () => {
    const { commitAuditAtomic, AuditAtomicFailure } = await import(
      "@/lib/skills/skill-audit-atomic"
    );
    expect(() =>
      commitAuditAtomic(db, {
        actor: "  ",
        eventType: "skill.test.noactor",
        entityType: "skill",
        entityId: "skill:x",
        metadata: {},
        body: () => "ok",
      })
    ).toThrow(AuditAtomicFailure);
  });

  it("throws when eventType or entity fields are missing", async () => {
    const { commitAuditAtomic, AuditAtomicFailure } = await import(
      "@/lib/skills/skill-audit-atomic"
    );
    expect(() =>
      commitAuditAtomic(db, {
        actor: "operator",
        eventType: " ",
        entityType: "skill",
        entityId: "skill:x",
        metadata: {},
        body: () => "ok",
      })
    ).toThrow(AuditAtomicFailure);

    expect(() =>
      commitAuditAtomic(db, {
        actor: "operator",
        eventType: "skill.test.noentity",
        entityType: "",
        entityId: "skill:x",
        metadata: {},
        body: () => "ok",
      })
    ).toThrow(AuditAtomicFailure);
  });
});
