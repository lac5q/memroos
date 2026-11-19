// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

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

describe("skill-quarantine batch17 — scanner parse and read-back failure", () => {
  it("getQuarantineRecord parses invalid scanner_result JSON as null", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertSkill(db, `q-b17-${crypto.randomUUID().slice(0, 6)}`, "body");
    db.prepare(`INSERT INTO skill_quarantine (skill_id, stage, scanner_result, created_at, updated_at) VALUES (?, 'imported', ?, ?, ?)`).run(
      skillId,
      "{bad-json",
      new Date().toISOString(),
      new Date().toISOString(),
    );
    const { getQuarantineRecord } = await import("../skill-quarantine");
    const record = getQuarantineRecord(db, skillId);
    expect(record?.scanner_result).toBeNull();
    db.close();
  });

  it("scoreVerificationChecks returns zero when no verification lines match body tokens", async () => {
    const { scoreVerificationChecks } = await import("../skill-quarantine");
    expect(scoreVerificationChecks("alpha beta gamma", "- unrelated\n- tokens")).toBe(0);
  });
});
