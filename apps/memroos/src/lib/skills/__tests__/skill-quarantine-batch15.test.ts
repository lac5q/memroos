// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";

describe("skill-quarantine batch15 — corrupt scanner rows and pipeline edges", () => {
  it("getQuarantineRecord tolerates invalid scanner_result JSON", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = Number(
      db
        .prepare(
          `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
            version, preconditions, allowed_tools, verification_checks, rollback_behavior,
            raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
            evidence_examples, content_hash, trust_level)
           VALUES ('q-b15', '', 'ops', 'claude', 'low', 'quarantined', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
        )
        .run("body", new Date().toISOString(), crypto.createHash("sha256").update("body").digest("hex"))
        .lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO skill_quarantine (skill_id, stage, scanner_result, eval_score, approval_status, created_at, updated_at)
       VALUES (?, 'scanning', '{bad-json', NULL, 'pending', datetime('now'), datetime('now'))`,
    ).run(skillId);
    const { getQuarantineRecord } = await import("../skill-quarantine");
    const record = getQuarantineRecord(db, skillId);
    expect(record?.scanner_result).toBeNull();
    db.close();
  });

  it("runQuarantinePipeline blocks HIGH severity scanner matches", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = Number(
      db
        .prepare(
          `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
            version, preconditions, allowed_tools, verification_checks, rollback_behavior,
            raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
            evidence_examples, content_hash, trust_level)
           VALUES ('q-b15-scan', '', 'ops', 'claude', 'low', 'quarantined', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
        )
        .run("token='abcdefabcdefabcdefabcdefabcdefabcdefabcd'", new Date().toISOString(), crypto.createHash("sha256").update("x").digest("hex"))
        .lastInsertRowid,
    );
    const { runQuarantinePipeline } = await import("../skill-quarantine");
    const pipeline = runQuarantinePipeline(db, skillId, "Customer SSN is 123-45-6789", null);
    expect(pipeline.blocked).toBe(true);
    db.close();
  });

  it("scoreVerificationChecks returns zero when required tokens are absent", async () => {
    const { scoreVerificationChecks } = await import("../skill-quarantine");
    expect(scoreVerificationChecks("plain body", "must include xyzzyplugh keyword")).toBe(0);
  });
});
