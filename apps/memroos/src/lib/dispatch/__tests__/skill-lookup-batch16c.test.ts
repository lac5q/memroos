// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { lookupSkillContract } from "@/lib/dispatch/skill-lookup";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

function insertSkill(database: Database.Database, name: string, harness: string, dispatchStatus = "enabled") {
  const body = `body-${randomUUID()}`;
  const contentHash = createHash("sha256").update(body, "utf8").digest("hex");
  database
    .prepare(
      `INSERT INTO skill_registry (
        name, description, owner, source_harness, risk_tier, dispatch_status,
        version, preconditions, allowed_tools, verification_checks, rollback_behavior,
        raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
        evidence_examples, content_hash, trust_level, signature, lifecycle_state
      ) VALUES (?, '', 'ops', ?, 'low', ?, '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned', NULL, 'enabled')`,
    )
    .run(name, harness, dispatchStatus, body, new Date().toISOString(), contentHash);
  return contentHash;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("skill-lookup batch16c — missing skills and harness mismatch", () => {
  it("denies when skill name is unknown", () => {
    const database = freshDb();
    const result = lookupSkillContract(database, `missing-${randomUUID().slice(0, 8)}`);
    expect(result?.kind).toBe("denied");
    expect(result && "reason" in result ? result.reason : "").toMatch(/not found/i);
  });

  it("denies when sourceHarness filter does not match registry row", () => {
    const database = freshDb();
    const name = `harness-${randomUUID().slice(0, 8)}`;
    insertSkill(database, name, "claude");
    const result = lookupSkillContract(database, name, { sourceHarness: "codex" });
    expect(result?.kind).toBe("denied");
  });

  it("denies disabled dispatch_status even when completeness is full", () => {
    const database = freshDb();
    const name = `disabled-${randomUUID().slice(0, 8)}`;
    insertSkill(database, name, "claude", "disabled");
    const result = lookupSkillContract(database, name, { sourceHarness: "claude" });
    expect(result?.kind).toBe("denied");
    expect(result && "reason" in result ? result.reason : "").toMatch(/disabled/i);
  });
});
