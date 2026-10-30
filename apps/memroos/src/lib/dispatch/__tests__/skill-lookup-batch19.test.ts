// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
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

function insertSkill(
  database: Database.Database,
  opts: {
    name: string;
    dispatchStatus?: string;
    lifecycle?: string;
    completeness?: number;
    harness?: string;
  },
): void {
  const body = `body-${randomUUID()}`;
  const contentHash = createHash("sha256").update(body, "utf8").digest("hex");
  database
    .prepare(
      `INSERT INTO skill_registry (
        name, description, owner, source_harness, risk_tier, dispatch_status,
        version, preconditions, allowed_tools, verification_checks, rollback_behavior,
        raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
        evidence_examples, content_hash, trust_level, lifecycle_state
      ) VALUES (?, '', 'ops', ?, 'low', ?, '1.0.0', '', '', '', '', ?, ?, '[]', 'op', ?, '', ?, 'unsigned', ?)`,
    )
    .run(
      opts.name,
      opts.harness ?? "claude",
      opts.dispatchStatus ?? "enabled",
      body,
      opts.completeness ?? 100,
      new Date().toISOString(),
      contentHash,
      opts.lifecycle ?? "enabled",
    );
}

function legacyEnabledDb(): Database.Database {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE skill_registry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      owner TEXT,
      source_harness TEXT NOT NULL,
      risk_tier TEXT,
      dispatch_status TEXT,
      completeness_pct INTEGER,
      trust_level TEXT,
      signature TEXT,
      imported_at TEXT
    );
  `);
  return database;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("skill-lookup batch19 — legacy fallbacks and status labels", () => {
  it("falls back to minimal enabled query when lifecycle columns are missing", () => {
    const database = legacyEnabledDb();
    const name = `legacy-enabled-${randomUUID().slice(0, 8)}`;
    database
      .prepare(
        `INSERT INTO skill_registry
         (name, description, owner, source_harness, risk_tier, dispatch_status, completeness_pct, trust_level, signature, imported_at)
         VALUES (?, '', 'ops', 'claude', 'low', 'enabled', 100, 'unsigned', NULL, ?)`,
      )
      .run(name, new Date().toISOString());
    const result = lookupSkillContract(database, name, { sourceHarness: "claude" });
    expect(result?.kind).toBe("hit");
  });

  it("surfaces review, incomplete dispatch, and deprecated lifecycle labels", () => {
    const database = freshDb();
    const reviewName = `review-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name: reviewName, dispatchStatus: "review" });
    expect(lookupSkillContract(database, reviewName, { sourceHarness: "claude" })?.kind).toBe("denied");

    const incompleteDispatch = `dispatch-incomplete-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name: incompleteDispatch, dispatchStatus: "incomplete" });
    const incompleteResult = lookupSkillContract(database, incompleteDispatch, { sourceHarness: "claude" });
    expect(incompleteResult && "reason" in incompleteResult ? incompleteResult.reason : "").toMatch(/incomplete/i);

    const deprecated = `deprecated-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name: deprecated, dispatchStatus: "enabled", lifecycle: "deprecated" });
    const deprecatedResult = lookupSkillContract(database, deprecated, { sourceHarness: "claude" });
    expect(deprecatedResult && "reason" in deprecatedResult ? deprecatedResult.reason : "").toMatch(/deprecated/i);
  });

  it("minimal any-row lookup returns not found when registry table is broken", () => {
    const database = new Database(":memory:");
    database.exec(`CREATE TABLE skill_registry (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`);
    const name = `broken-${randomUUID().slice(0, 8)}`;
    database.prepare(`INSERT INTO skill_registry (name) VALUES (?)`).run(name);
    const result = lookupSkillContract(database, name, { sourceHarness: "claude" });
    expect(result?.kind).toBe("denied");
    expect(result && "reason" in result ? result.reason : "").toMatch(/not found/i);
  });
});
