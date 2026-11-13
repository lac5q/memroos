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
    harness?: string;
    dispatchStatus?: string | null;
    lifecycle?: string;
    signature?: string | null;
    body?: string;
    contentHash?: string;
    rawBody?: string | null;
  },
): void {
  const body = opts.body ?? `body-${randomUUID()}`;
  const contentHash = opts.contentHash ?? createHash("sha256").update(body, "utf8").digest("hex");
  const rawBody = opts.rawBody === undefined ? body : opts.rawBody;
  database
    .prepare(
      `INSERT INTO skill_registry (
        name, description, owner, source_harness, risk_tier, dispatch_status,
        version, preconditions, allowed_tools, verification_checks, rollback_behavior,
        raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
        evidence_examples, content_hash, trust_level, lifecycle_state, signature
      ) VALUES (?, '', 'ops', ?, 'low', ?, '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'signed', ?, ?)`,
    )
    .run(
      opts.name,
      opts.harness ?? "claude",
      opts.dispatchStatus ?? "enabled",
      rawBody,
      new Date().toISOString(),
      contentHash,
      opts.lifecycle ?? "enabled",
      opts.signature === undefined ? "sig-b27" : opts.signature,
    );
}

function legacyDbMissingLifecycle(): Database.Database {
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
      content_hash TEXT,
      raw_body TEXT,
      imported_at TEXT
    );
  `);
  return database;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("skill-lookup batch27 — body integrity, legacy fallback, unknown status label", () => {
  it("denies signed skills when content_hash is missing for body verification", () => {
    const database = freshDb();
    const name = `bad-body-b27-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name, signature: "sig-b27" });
    database.prepare("UPDATE skill_registry SET content_hash = NULL WHERE name = ?").run(name);
    const result = lookupSkillContract(database, name, { sourceHarness: "claude", requireSigned: true });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") return;
    expect(result.reason).toMatch(/integrity verification failed/i);
  });

  it("falls back when lifecycle_state column is missing on legacy databases", () => {
    const database = legacyDbMissingLifecycle();
    const name = `legacy-b27-${randomUUID().slice(0, 8)}`;
    const body = `legacy-body-${randomUUID()}`;
    const hash = createHash("sha256").update(body, "utf8").digest("hex");
    database
      .prepare(
        `INSERT INTO skill_registry
          (name, description, owner, source_harness, risk_tier, dispatch_status, completeness_pct, trust_level, signature, content_hash, raw_body, imported_at)
         VALUES (?, '', 'ops', 'claude', 'low', 'enabled', 100, 'unsigned', NULL, ?, ?, datetime('now'))`,
      )
      .run(name, hash, body);
    const result = lookupSkillContract(database, name, { sourceHarness: "claude" });
    expect(result?.kind).toBe("hit");
  });

  it("denies enabled rows whose lifecycle_state is retired", () => {
    const database = freshDb();
    const name = `retired-b27-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name, lifecycle: "retired" });
    const result = lookupSkillContract(database, name, { sourceHarness: "claude" });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") return;
    expect(result.reason).toMatch(/retired/i);
  });
});
