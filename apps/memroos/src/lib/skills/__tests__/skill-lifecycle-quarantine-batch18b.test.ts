// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";

function insertSkill(db: Database.Database, lifecycle = "enabled"): number {
  const body = `skill-body-${crypto.randomUUID().slice(0, 6)}`;
  return Number(
    db
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level, lifecycle_state)
         VALUES (?, '', 'ops', 'claude', 'low', 'quarantined', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned', ?)`,
      )
      .run(`skill-b18b-${crypto.randomUUID().slice(0, 6)}`, body, new Date().toISOString(), crypto.createHash("sha256").update(body).digest("hex"), lifecycle)
      .lastInsertRowid,
  );
}

describe("skills batch18b — lifecycle + quarantine", () => {
  it("transitionLifecycleState blocks retired -> enabled", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertSkill(db, "retired");
    db.prepare(`INSERT INTO skill_quarantine (skill_id, stage) VALUES (?, 'enabled')`).run(skillId);
    const { transitionLifecycleState, LifecycleTransitionError } = await import("../skill-lifecycle");
    expect(() => transitionLifecycleState(db, skillId, "enabled", "operator", "revive")).toThrow(LifecycleTransitionError);
    db.close();
  });

  it("scoreVerificationChecks returns partial credit for overlapping tokens", async () => {
    const { scoreVerificationChecks } = await import("../skill-quarantine");
    expect(scoreVerificationChecks("run npm test before deploy", "- run npm test\n- check logs")).toBeGreaterThan(0);
  });

  it("listQuarantineRecords respects stage filter", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertSkill(db);
    db.prepare(
      `INSERT INTO skill_quarantine (skill_id, stage, scanner_result, created_at, updated_at)
       VALUES (?, 'pending_approval', ?, ?, ?)`,
    ).run(skillId, JSON.stringify({ ok: true }), new Date().toISOString(), new Date().toISOString());
    const { listQuarantineRecords } = await import("../skill-quarantine");
    const items = listQuarantineRecords(db, { stage: "pending_approval" });
    expect(items.some((item) => item.skill_id === skillId)).toBe(true);
    db.close();
  });
});
