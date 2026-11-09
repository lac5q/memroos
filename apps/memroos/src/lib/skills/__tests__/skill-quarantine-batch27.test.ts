// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";

function insertSkill(db: Database.Database, body: string): number {
  const name = `q-b27-${crypto.randomUUID().slice(0, 6)}`;
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

afterEach(() => {
  // no shared state
});

describe("skill-quarantine batch27 — approve/reject readback paths", () => {
  it("approveQuarantine returns the enabled record after dispatch flip", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertSkill(db, "approve body batch27");
    const { runQuarantinePipeline, approveQuarantine } = await import("../skill-quarantine");
    runQuarantinePipeline(db, skillId, "approve body batch27", "- must include approve body batch27");
    db.prepare(`UPDATE skill_quarantine SET stage = 'pending_approval' WHERE skill_id = ?`).run(skillId);
    const approved = approveQuarantine(db, skillId, "operator-b27");
    expect(approved.stage).toBe("enabled");
    const dispatch = db
      .prepare(`SELECT dispatch_status FROM skill_registry WHERE id = ?`)
      .get(skillId) as { dispatch_status: string };
    expect(dispatch.dispatch_status).toBe("enabled");
    db.close();
  });

  it("rejectQuarantine returns the rejected record after audit write", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertSkill(db, "reject body batch27");
    const { runQuarantinePipeline, rejectQuarantine } = await import("../skill-quarantine");
    runQuarantinePipeline(db, skillId, "reject body batch27", null);
    db.prepare(`UPDATE skill_quarantine SET stage = 'pending_approval' WHERE skill_id = ?`).run(skillId);
    const rejected = rejectQuarantine(db, skillId, "operator-b27", "policy batch27");
    expect(rejected.stage).toBe("rejected");
    db.close();
  });
});
