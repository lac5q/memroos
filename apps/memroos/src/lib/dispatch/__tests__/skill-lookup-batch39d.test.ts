// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { lookupSkillContract } from "../skill-lookup";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("skill-lookup batch39d", () => {
  it.skip("raw dispatch_status fallback label (625) — registry CHECK constraint blocks unknown statuses", () => {});

  it("denies quarantined skills with explicit status label (613-617)", () => {
    const database = freshDb();
    const name = `quarantine-b39d-${randomUUID().slice(0, 8)}`;
    database
      .prepare(
        `INSERT INTO skill_registry (
          name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level, lifecycle_state
        ) VALUES (?, '', 'ops', 'codex', 'low', 'quarantined', '1.0.0', '', '', '', '', 'body', 100, '[]', 'op', datetime('now'), '', ?, 'unsigned', 'enabled')`,
      )
      .run(name, "a".repeat(64));
    const result = lookupSkillContract(database, name, { sourceHarness: "codex" });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") return;
    expect(result.reason).toContain("quarantined");
  });
});