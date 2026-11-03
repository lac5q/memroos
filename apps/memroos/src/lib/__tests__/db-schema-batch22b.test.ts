// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { getSchemaVersion, initSchema } from "@/lib/db-schema";

describe("db-schema batch22b — version parsing and SKILLTRUST backfill", () => {
  it("getSchemaVersion coerces string pragma values to numbers", () => {
    const db = new Database(":memory:");
    db.pragma("user_version = 7");
    expect(getSchemaVersion(db)).toBe(7);
    db.close();
  });

  it("initSchema backfills malformed missing_fields_json during SKILLTRUST migration", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const id = db
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
            version, preconditions, allowed_tools, verification_checks, rollback_behavior,
            raw_body, completeness_pct, missing_fields_json, imported_by, imported_at, evidence_examples)
         VALUES ('legacy-skill', '', 'ops', 'memroos', 'low', 'enabled', '1.0.0', '', '', '', '', 'body', 100, 'not-json', 'test', datetime('now'), '')`,
      )
      .run().lastInsertRowid as number;
    db.pragma("user_version = 10");
    initSchema(db);
    const row = db
      .prepare(`SELECT completeness_pct, missing_fields_json FROM skill_registry WHERE id = ?`)
      .get(id) as { completeness_pct: number; missing_fields_json: string };
    expect(row.completeness_pct).toBeLessThanOrEqual(91);
    expect(JSON.parse(row.missing_fields_json)).toContain("evidence_examples");
    db.close();
  });
});
