// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { QuarantineTransitionError } from "../skill-quarantine";

function insertSkill(db: Database.Database, body: string, checks: string | null = null): number {
  const name = `q-b35-${crypto.randomUUID().slice(0, 6)}`;
  return Number(
    db
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level, lifecycle_state)
         VALUES (?, '', 'ops', 'claude', 'low', 'quarantined', '1.0.0', '', '', ?, '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned', 'draft')`,
      )
      .run(name, checks ?? "", body, new Date().toISOString(), crypto.createHash("sha256").update(body).digest("hex"))
      .lastInsertRowid,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.MEMROOS_QUARANTINE_EVAL_THRESHOLD;
});

describe("skill-quarantine batch35 — listing, scoring, and guard branches", () => {
  it("getQuarantineRecord returns null for corrupt scanner JSON (103–104)", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertSkill(db, "corrupt scanner batch35");
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO skill_quarantine (skill_id, stage, scanner_result, eval_score, approval_status, created_at, updated_at)
       VALUES (?, 'scanning', '{not-json', NULL, 'pending', ?, ?)`,
    ).run(skillId, now, now);
    const { getQuarantineRecord } = await import("../skill-quarantine");
    const rec = getQuarantineRecord(db, skillId);
    expect(rec?.scanner_result).toBeNull();
    db.close();
  });

  it("listQuarantineRecords honors stage, approval, limit, and offset (167–200)", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const { upsertQuarantineRecord, listQuarantineRecords } = await import("../skill-quarantine");
    const ids: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const skillId = insertSkill(db, `list b35-${i}`);
      ids.push(skillId);
      upsertQuarantineRecord(db, {
        skillId,
        stage: i === 2 ? "rejected" : "pending_approval",
        approvalStatus: i === 2 ? "rejected" : "pending",
      });
    }
    const page = listQuarantineRecords(db, {
      stage: "pending_approval",
      approvalStatus: "pending",
      limit: 1,
      offset: 0,
    });
    expect(page).toHaveLength(1);
    expect(page[0]?.stage).toBe("pending_approval");
    db.close();
  });

  it("resolveEvalThreshold clamps env overrides (481–486)", async () => {
    const { resolveEvalThreshold } = await import("../skill-quarantine");
    expect(resolveEvalThreshold()).toBe(0.5);
    process.env.MEMROOS_QUARANTINE_EVAL_THRESHOLD = "not-a-number";
    expect(resolveEvalThreshold()).toBe(0.5);
    process.env.MEMROOS_QUARANTINE_EVAL_THRESHOLD = "2.5";
    expect(resolveEvalThreshold()).toBe(1);
    process.env.MEMROOS_QUARANTINE_EVAL_THRESHOLD = "-1";
    expect(resolveEvalThreshold()).toBe(0);
  });

  it("scoreVerificationChecks returns 1.0 when verification checks are empty (493–494)", async () => {
    const { scoreVerificationChecks } = await import("../skill-quarantine");
    expect(scoreVerificationChecks("batch35 body", null)).toBe(1);
    expect(scoreVerificationChecks("batch35 body", "   ")).toBe(1);
  });

  it("runQuarantinePipeline rejects low eval score (588–600)", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const body = "minimal";
    const skillId = insertSkill(db, body, "- completely-missing-token-xyzzy");
    const { runQuarantinePipeline } = await import("../skill-quarantine");
    const result = runQuarantinePipeline(db, skillId, body, "- completely-missing-token-xyzzy", { evalThreshold: 0.99 });
    expect(result.blocked).toBe(true);
    expect(result.advancedTo).toBe("rejected");
    db.close();
  });

  it("upsertQuarantineRecord updates existing row (399–410)", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertSkill(db, "upsert batch35");
    const { upsertQuarantineRecord, getQuarantineRecord } = await import("../skill-quarantine");
    upsertQuarantineRecord(db, { skillId, stage: "imported" });
    const updated = upsertQuarantineRecord(db, { skillId, stage: "scanning", evalScore: 0.8 });
    expect(updated.stage).toBe("scanning");
    expect(getQuarantineRecord(db, skillId)?.eval_score).toBe(0.8);
    db.close();
  });

  it("approveQuarantine requires operator identity (633–636)", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertSkill(db, "approve guard batch35");
    const { runQuarantinePipeline, approveQuarantine } = await import("../skill-quarantine");
    runQuarantinePipeline(db, skillId, "approve guard batch35", null);
    expect(() => approveQuarantine(db, skillId, "   ")).toThrow(QuarantineTransitionError);
    db.close();
  });

  it("rejectQuarantine refuses enabled stage (710–713)", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertSkill(db, "reject enabled batch35");
    const { insertQuarantineRecord, rejectQuarantine } = await import("../skill-quarantine");
    insertQuarantineRecord(db, { skillId, stage: "enabled", approvalStatus: "approved" });
    expect(() => rejectQuarantine(db, skillId, "operator-b35", "too late")).toThrow(QuarantineTransitionError);
    db.close();
  });
});
