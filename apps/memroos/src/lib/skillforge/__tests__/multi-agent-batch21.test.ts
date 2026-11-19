// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { importSkillPackage, syncSkillsWithAgent } from "../multi-agent";

describe("skillforge multi-agent batch21 — import and sync error paths", () => {
  it("importSkillPackage captures registry insert failures", () => {
    const db = new Database(":memory:");
    initSchema(db);
    db.exec("DROP TABLE skill_registry");
    const result = importSkillPackage(db, {
      id: "pkg-b21",
      skillId: "42",
      name: "Broken registry",
      content: "# Skill",
      metadata: {
        version: "1.0.0",
        author: "tester",
        tags: ["a"],
        evalReceipts: [{ provider: "local", model: "m", dimensions: { quality: 0.95 }, timestamp: "2026-07-01T00:00:00.000Z" }],
      },
      compatibility: ["memroos"],
      exportedAt: "2026-07-01T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    db.close();
  });

  it("syncSkillsWithAgent records sync log failures without stopping the loop", () => {
    const db = new Database(":memory:");
    initSchema(db);
    db.exec("ALTER TABLE skill_registry ADD COLUMN content TEXT DEFAULT ''");
    db.exec("ALTER TABLE skill_registry ADD COLUMN author TEXT DEFAULT 'tester'");
    db.exec("ALTER TABLE skill_registry ADD COLUMN tags TEXT DEFAULT '[]'");
    const body = "# Sync skill";
    const skillId = String(
      db
        .prepare(
          `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
              version, preconditions, allowed_tools, verification_checks, rollback_behavior,
              raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
              evidence_examples, content_hash, trust_level, content, author, tags)
           VALUES ('sync-b21', '', 'ops', 'memroos', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'batch21', ?, '', 'abc', 'unsigned', ?, 'tester', '[]')`,
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
