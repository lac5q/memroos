// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { CURRENT_SCHEMA_VERSION, getSchemaVersion, initSchema } from "@/lib/db-schema";

describe("db-schema batch13b — SKILLTRUST-01 backfill paths", () => {
  it("re-running migration v11 backfills legacy rows missing evidence_examples", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillName = `legacy-skill-${crypto.randomUUID().slice(0, 8)}`;
    const id = db
      .prepare(
        `INSERT INTO skill_registry (
          name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level
        ) VALUES (?, '', 'ops', 'claude', 'low', 'enabled', '1.0.0', '', '', '', '', 'body', 100, 'not-json', 'op', ?, '', NULL, 'unsigned')`
      )
      .run(skillName, new Date().toISOString()).lastInsertRowid as number;

    db.pragma("user_version = 10");
    initSchema(db);

    const row = db
      .prepare(`SELECT completeness_pct, missing_fields_json FROM skill_registry WHERE id = ?`)
      .get(id) as { completeness_pct: number; missing_fields_json: string };
    expect(row.completeness_pct).toBe(91);
    const missing = JSON.parse(row.missing_fields_json) as string[];
    expect(missing).toContain("evidence_examples");
    expect(getSchemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
    db.close();
  });

  it("backfill preserves sub-100 completeness_pct while appending evidence_examples", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const id = db
      .prepare(
        `INSERT INTO skill_registry (
          name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level
        ) VALUES ('partial-skill', '', 'ops', 'claude', 'low', 'enabled', '1.0.0', '', '', '', '', 'body', 80, '[]', 'op', ?, '', NULL, 'unsigned')`
      )
      .run(new Date().toISOString()).lastInsertRowid as number;

    db.pragma("user_version = 10");
    initSchema(db);

    const row = db
      .prepare(`SELECT completeness_pct, missing_fields_json FROM skill_registry WHERE id = ?`)
      .get(id) as { completeness_pct: number; missing_fields_json: string };
    expect(row.completeness_pct).toBe(80);
    expect(JSON.parse(row.missing_fields_json)).toContain("evidence_examples");
    db.close();
  });

  it("rejects databases stamped newer than supported schema version", () => {
    const db = new Database(":memory:");
    initSchema(db);
    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION + 1}`);
    expect(() => initSchema(db)).toThrow(/newer than this code supports/);
    db.close();
  });
});
