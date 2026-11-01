// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

function insertSkill(db: Database.Database, lifecycle = "enabled"): number {
  const body = `body-${crypto.randomUUID().slice(0, 6)}`;
  return Number(
    db
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level, lifecycle_state)
         VALUES (?, '', 'ops', 'claude', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned', ?)`,
      )
      .run(
        `lc-b20-${crypto.randomUUID().slice(0, 6)}`,
        body,
        new Date().toISOString(),
        crypto.createHash("sha256").update(body).digest("hex"),
        lifecycle,
      )
      .lastInsertRowid,
  );
}

describe("skill-lifecycle batch20 — guard rails and invalid state", () => {
  it("removeSkillDependency and getDependents reject invalid ids", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const { removeSkillDependency, getDependents } = await import("../skill-lifecycle");
    expect(removeSkillDependency(db, 0, "agent")).toBe(false);
    expect(removeSkillDependency(db, 1.5 as unknown as number, "agent")).toBe(false);
    expect(removeSkillDependency(db, 1, "")).toBe(false);
    expect(getDependents(db, -3)).toEqual([]);
    db.close();
  });

  it("getLifecycleAuditTrail clamps limit and returns empty for bad skillId", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertSkill(db);
    const { getLifecycleAuditTrail } = await import("../skill-lifecycle");
    expect(getLifecycleAuditTrail(db, { skillId: 0 })).toEqual([]);
    expect(getLifecycleAuditTrail(db, { skillId, limit: 9999 }).length).toBeLessThanOrEqual(200);
    db.close();
  });

  it("transitionLifecycleState validates actor and missing registry rows", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertSkill(db);
    const { transitionLifecycleState, LifecycleTransitionError } = await import("../skill-lifecycle");
    expect(() => transitionLifecycleState(db, 0, "enabled", "ops", "reason")).toThrow(LifecycleTransitionError);
    expect(() => transitionLifecycleState(db, skillId, "enabled", "  ", "reason")).toThrow(/actor must/);
    expect(() => transitionLifecycleState(db, 99999, "enabled", "ops", "reason")).toThrow(/not found|invalid/i);
    db.close();
  });

  it("transitionLifecycleState rethrows audit failures when audit_entries exists", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertSkill(db, "draft");
    db.prepare(
      `INSERT INTO skill_quarantine (skill_id, stage, approval_status, created_at, updated_at)
       VALUES (?, 'pending_approval', 'pending', ?, ?)`,
    ).run(skillId, new Date().toISOString(), new Date().toISOString());
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      const stmt = originalPrepare(sql);
      if (sql.includes("INSERT INTO audit_entries")) {
        return {
          ...stmt,
          run: () => {
            throw new Error("audit insert failed on purpose");
          },
        } as ReturnType<typeof originalPrepare>;
      }
      return stmt;
    });
    const { transitionLifecycleState } = await import("../skill-lifecycle");
    expect(() => transitionLifecycleState(db, skillId, "enabled", "operator", "go live")).toThrow(/audit insert failed/);
    db.close();
  });
});
