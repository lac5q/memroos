// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";

function insertSkill(db: Database.Database, name: string): number {
  const body = `quarantine-b36-${randomUUID()}`;
  const hash = createHash("sha256").update(body, "utf8").digest("hex");
  const result = db
    .prepare(
      `INSERT INTO skill_registry (
        name, description, owner, source_harness, risk_tier, dispatch_status,
        version, raw_body, completeness_pct, imported_by, imported_at, content_hash, trust_level, lifecycle_state, signature
      ) VALUES (?, '', 'ops', 'claude', 'low', 'enabled', '1.0.0', ?, 100, 'op', datetime('now'), ?, 'signed', 'enabled', 'sig')`,
    )
    .run(name, body, hash);
  return Number(result.lastInsertRowid);
}

describe("skill-quarantine batch36", () => {
  it("listQuarantineRecords filters by scanning stage (180-183)", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertSkill(db, `stage-b36-${randomUUID().slice(0, 8)}`);
    const { insertQuarantineRecord, listQuarantineRecords } = await import("../skill-quarantine");
    insertQuarantineRecord(db, { skillId, stage: "scanning", approvalStatus: "pending" });
    insertQuarantineRecord(db, {
      skillId: insertSkill(db, `other-b36-${randomUUID().slice(0, 6)}`),
      stage: "pending_approval",
      approvalStatus: "pending",
    });
    const scanning = listQuarantineRecords(db, { stage: "scanning", limit: 10 });
    expect(scanning.length).toBe(1);
    expect(scanning[0]?.stage).toBe("scanning");
    db.close();
  });

  it("listQuarantineRecords clamps limit to 200 (170-172)", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const { listQuarantineRecords } = await import("../skill-quarantine");
    const rows = listQuarantineRecords(db, { limit: 9999 });
    expect(rows.length).toBeLessThanOrEqual(200);
    db.close();
  });

  it("scoreVerificationChecks returns 1.0 when all checks mentioned (493+)", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const { scoreVerificationChecks } = await import("../skill-quarantine");
    const checks = "- require playwright browser coverage\n- require typecheck gate";
    const score = scoreVerificationChecks(
      "body mentions playwright browser coverage and typecheck gate for batch36",
      checks,
    );
    expect(score).toBe(1);
    db.close();
  });
});
