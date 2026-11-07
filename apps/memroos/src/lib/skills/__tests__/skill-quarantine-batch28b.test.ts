// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { QuarantineTransitionError } from "../skill-quarantine";

function insertSkill(db: Database.Database, body: string): number {
  const name = `q-b28b-${crypto.randomUUID().slice(0, 6)}`;
  return Number(
    db
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level, lifecycle_state)
         VALUES (?, '', 'ops', 'claude', 'low', 'quarantined', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned', 'draft')`,
      )
      .run(name, body, new Date().toISOString(), crypto.createHash("sha256").update(body).digest("hex"))
      .lastInsertRowid,
  );
}

describe("skill-quarantine batch28b — approval guard rails", () => {
  it("approveQuarantine requires operator identity", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertSkill(db, "operator required batch28b");
    const { runQuarantinePipeline, approveQuarantine } = await import("../skill-quarantine");
    runQuarantinePipeline(db, skillId, "operator required batch28b", "- must include operator required batch28b");
    db.prepare(`UPDATE skill_quarantine SET stage = 'pending_approval' WHERE skill_id = ?`).run(skillId);
    expect(() => approveQuarantine(db, skillId, "   ")).toThrow(QuarantineTransitionError);
    db.close();
  });

  it("rejectQuarantine requires a non-empty rejection reason", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertSkill(db, "reason required batch28b");
    const { runQuarantinePipeline, rejectQuarantine } = await import("../skill-quarantine");
    runQuarantinePipeline(db, skillId, "reason required batch28b", null);
    db.prepare(`UPDATE skill_quarantine SET stage = 'pending_approval' WHERE skill_id = ?`).run(skillId);
    expect(() => rejectQuarantine(db, skillId, "operator-b28b", "  ")).toThrow(/Rejection reason is required/);
    db.close();
  });
});
