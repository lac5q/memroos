// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";

function insertSkill(db: Database.Database, name: string): number {
  const body = `quarantine-b35b-${randomUUID()}`;
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

describe("skill-quarantine batch35b", () => {
  it("listQuarantineRecords respects approvalStatus filter (167–200)", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertSkill(db, `list-b35b-${randomUUID().slice(0, 8)}`);
    const { insertQuarantineRecord, listQuarantineRecords } = await import("../skill-quarantine");
    insertQuarantineRecord(db, { skillId, stage: "pending_approval", approvalStatus: "pending" });
    const pending = listQuarantineRecords(db, { approvalStatus: "pending", limit: 10 });
    expect(pending.length).toBe(1);
    const approved = listQuarantineRecords(db, { approvalStatus: "approved", limit: 10 });
    expect(approved.length).toBe(0);
    db.close();
  });

  it("scoreVerificationChecks returns partial credit when body misses checks (493+)", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const { scoreVerificationChecks } = await import("../skill-quarantine");
    const score = scoreVerificationChecks("batch35b body includes typecheck", "must include npm test\nmust include typecheck");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
    db.close();
  });
});
