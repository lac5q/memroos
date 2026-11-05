// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { getSchemaVersion, initSchema } from "@/lib/db-schema";

describe("db-schema batch27 — SKILLTRUST backfill filter and version guard", () => {
  it("filters non-string entries from missing_fields_json arrays during v11 backfill", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const id = db
      .prepare(
        `INSERT INTO skill_registry (
          name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level
        ) VALUES (?, '', 'ops', 'claude', 'low', 'enabled', '1.0.0', '', '', '', '', 'body', 100, ?, 'op', ?, '', NULL, 'unsigned')`,
      )
      .run(
        `legacy-b27-${crypto.randomUUID().slice(0, 8)}`,
        JSON.stringify(["allowed", 42, null]),
        new Date().toISOString(),
      ).lastInsertRowid as number;

    db.pragma("user_version = 10");
    initSchema(db);

    const row = db
      .prepare(`SELECT missing_fields_json FROM skill_registry WHERE id = ?`)
      .get(id) as { missing_fields_json: string };
    const missing = JSON.parse(row.missing_fields_json) as string[];
    expect(missing.every((field) => typeof field === "string")).toBe(true);
    expect(missing).toContain("evidence_examples");
    db.close();
  });

  it("getSchemaVersion still coerces string pragma values after migrations", () => {
    const db = new Database(":memory:");
    initSchema(db);
    db.pragma("user_version = 12");
    expect(getSchemaVersion(db)).toBe(12);
    db.close();
  });
});
