// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

function insertSkill(db: Database.Database, name: string, body: string): number {
  return Number(
    db
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level)
         VALUES (?, '', 'ops', 'claude', 'low', 'quarantined', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
      )
      .run(name, body, new Date().toISOString(), crypto.createHash("sha256").update(body).digest("hex"))
      .lastInsertRowid,
  );
}

describe("skill-quarantine batch16 — audit swallow, scoring, and transitions", () => {
  it("writeQuarantineAudit swallows errors when audit_entries table is missing", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE skill_registry (id INTEGER PRIMARY KEY AUTOINCREMENT, dispatch_status TEXT, lifecycle_state TEXT);
      CREATE TABLE skill_quarantine (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        skill_id INTEGER NOT NULL,
        stage TEXT NOT NULL,
        scanner_result TEXT,
        eval_score REAL,
        approval_status TEXT,
        approved_by TEXT,
        approved_at TEXT,
        rejection_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const skillId = Number(
      db.prepare(`INSERT INTO skill_registry (dispatch_status, lifecycle_state) VALUES ('quarantined', 'quarantined')`).run()
        .lastInsertRowid,
    );
    const { insertQuarantineRecord } = await import("../skill-quarantine");
    const record = insertQuarantineRecord(db, { skillId, stage: "imported" });
    expect(record.stage).toBe("imported");
    db.close();
  });

  it("scoreVerificationChecks treats blank verification lines as full pass", async () => {
    const { scoreVerificationChecks, resolveEvalThreshold } = await import("../skill-quarantine");
    expect(scoreVerificationChecks("body", "   \n  ")).toBe(1);
    vi.stubEnv("MEMROOS_QUARANTINE_EVAL_THRESHOLD", "not-a-number");
    expect(resolveEvalThreshold()).toBe(0.5);
    vi.unstubAllEnvs();
  });

  it("scoreVerificationChecks awards credit for lines with only short tokens", async () => {
    const { scoreVerificationChecks } = await import("../skill-quarantine");
    expect(scoreVerificationChecks("hello world", "- aa bb cc")).toBe(1);
  });

  it("approveQuarantine and rejectQuarantine enforce stage and identity guards", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertSkill(db, "q-b16", "safe body content");
    const {
      runQuarantinePipeline,
      approveQuarantine,
      rejectQuarantine,
      QuarantineTransitionError,
    } = await import("../skill-quarantine");

    runQuarantinePipeline(db, skillId, "safe body content", null);
    expect(() => approveQuarantine(db, skillId, "  ")).toThrow(QuarantineTransitionError);
    expect(() => rejectQuarantine(db, skillId, "ops", "")).toThrow(QuarantineTransitionError);

    db.prepare(
      `UPDATE skill_quarantine SET stage = 'scanning', approval_status = 'pending' WHERE skill_id = ?`,
    ).run(skillId);
    expect(() => approveQuarantine(db, skillId, "alice")).toThrow(/pending_approval/);

    const pendingId = insertSkill(db, "q-b16-pending", "another safe body");
    runQuarantinePipeline(db, pendingId, "another safe body", null);
    db.prepare(`UPDATE skill_quarantine SET stage = 'pending_approval' WHERE skill_id = ?`).run(pendingId);
    const approved = approveQuarantine(db, pendingId, "alice");
    expect(approved.stage).toBe("enabled");

    const rejectId = insertSkill(db, "q-b16-reject", "reject body");
    runQuarantinePipeline(db, rejectId, "reject body", null);
    db.prepare(`UPDATE skill_quarantine SET stage = 'pending_approval' WHERE skill_id = ?`).run(rejectId);
    const rejected = rejectQuarantine(db, rejectId, "bob", "policy");
    expect(rejected.stage).toBe("rejected");
    db.close();
  });

  it("updateQuarantineRecord throws when skill row disappears mid-flight", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertSkill(db, "q-b16-missing", "body");
    const mod = await import("../skill-quarantine");
    mod.insertQuarantineRecord(db, { skillId, stage: "imported" });
    db.prepare(`DELETE FROM skill_quarantine WHERE skill_id = ?`).run(skillId);
    expect(() => mod.updateQuarantineRecord(db, skillId, { stage: "scanning" })).toThrow(/row not found/);
    db.close();
  });
});
