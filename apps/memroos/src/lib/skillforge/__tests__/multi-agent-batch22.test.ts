// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { syncSkillsWithAgent } from "../multi-agent";

describe("skillforge multi-agent batch22 — sync log catch branch", () => {
  it("syncSkillsWithAgent captures sync log insert failures per skill", () => {
    const db = new Database(":memory:");
    initSchema(db);
    db.exec("ALTER TABLE skill_registry ADD COLUMN content TEXT DEFAULT ''");
    db.exec("ALTER TABLE skill_registry ADD COLUMN author TEXT DEFAULT 'tester'");
    db.exec("ALTER TABLE skill_registry ADD COLUMN tags TEXT DEFAULT '[]'");
    const body = "# Sync skill batch22";
    const skillId = String(
      db
        .prepare(
          `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
              version, preconditions, allowed_tools, verification_checks, rollback_behavior,
              raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
              evidence_examples, content_hash, trust_level, content, author, tags)
           VALUES ('sync-b22', '', 'ops', 'memroos', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'batch22', ?, '', 'abc', 'unsigned', ?, 'tester', '[]')`,
        )
        .run(body, new Date().toISOString(), body).lastInsertRowid,
    );
    db.exec("DROP TABLE skill_sync_log");
    const result = syncSkillsWithAgent(db, "http://localhost:9999", [skillId]);
    expect(result.synced).toBe(0);
    expect(result.errors.some((e) => e.includes("Failed to log sync"))).toBe(true);
    db.close();
  });
});
