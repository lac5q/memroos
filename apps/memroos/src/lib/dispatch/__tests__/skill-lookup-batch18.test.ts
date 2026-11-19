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
    harness: string;
    body?: string;
    dispatchStatus?: string;
    completeness?: number;
    trust?: string;
    signature?: string | null;
    version?: string;
  },
): { contentHash: string; version: string } {
  const body = opts.body ?? `body-${randomUUID()}`;
  const contentHash = createHash("sha256").update(body, "utf8").digest("hex");
  const version = opts.version ?? "1.0.0";
  database
    .prepare(
      `INSERT INTO skill_registry (
        name, description, owner, source_harness, risk_tier, dispatch_status,
        version, preconditions, allowed_tools, verification_checks, rollback_behavior,
        raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
        evidence_examples, content_hash, trust_level, signature, lifecycle_state
      ) VALUES (?, '', 'ops', ?, 'low', ?, ?, '', '', '', '', ?, ?, '[]', 'op', ?, '', ?, ?, ?, 'enabled')`,
    )
    .run(
      opts.name,
      opts.harness,
      opts.dispatchStatus ?? "enabled",
      version,
      body,
      opts.completeness ?? 100,
      new Date().toISOString(),
      contentHash,
      opts.trust ?? "unsigned",
      opts.signature ?? null,
    );
  return { contentHash, version };
}

function legacyDb(): Database.Database {
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

describe("skill-lookup batch18 — version mismatch and legacy schema fallback", () => {
  it("denies when explicit version does not match the enabled registry row", () => {
    const database = freshDb();
    const name = `version-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name, harness: "claude", version: "2.0.0" });
    const result = lookupSkillContract(database, name, {
      sourceHarness: "claude",
      version: "9.0.0",
    });
    expect(result?.kind).toBe("denied");
    expect(result && "reason" in result ? result.reason : "").toMatch(/version mismatch/i);
  });

  it("denies verified skills when raw_body hash no longer matches content_hash", () => {
    const database = freshDb();
    const name = `verified-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name, harness: "claude", trust: "verified", signature: "sig-present" });
    database.prepare(`UPDATE skill_registry SET raw_body = ? WHERE name = ?`).run("tampered", name);
    const result = lookupSkillContract(database, name, { sourceHarness: "claude", minTrustLevel: "signed" });
    expect(result?.kind).toBe("denied");
    expect(result && "reason" in result ? result.reason : "").toMatch(/integrity verification failed/i);
  });

  it("falls back to legacy skill_registry schema without lifecycle_state columns", () => {
    const database = legacyDb();
    const name = `legacy-${randomUUID().slice(0, 8)}`;
    database
      .prepare(
        `INSERT INTO skill_registry
         (name, description, owner, source_harness, risk_tier, dispatch_status, completeness_pct, trust_level, signature, imported_at)
         VALUES (?, '', 'ops', 'claude', 'low', 'enabled', 100, 'unsigned', NULL, ?)`,
      )
      .run(name, new Date().toISOString());
    const result = lookupSkillContract(database, name, { sourceHarness: "claude" });
    expect(result?.kind).toBe("hit");
    if (result?.kind === "hit") {
      expect(result.skill.name).toBe(name);
    }
  });
});
