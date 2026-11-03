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
    dispatchStatus?: string;
    lifecycle?: string;
    signature?: string | null;
    body?: string;
    contentHash?: string;
  },
): void {
  const body = opts.body ?? `body-${randomUUID()}`;
  const contentHash = opts.contentHash ?? createHash("sha256").update(body, "utf8").digest("hex");
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
      body,
      new Date().toISOString(),
      contentHash,
      opts.lifecycle ?? "enabled",
      opts.signature === undefined ? "sig-b26" : opts.signature,
    );
}

function legacyDbMissingRawBody(): Database.Database {
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
      imported_at TEXT
    );
  `);
  return database;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("skill-lookup batch26 — legacy body gate, quarantine label, ambiguity", () => {
  it("legacy rows without raw_body skip body re-verification when requireSigned", () => {
    const database = legacyDbMissingRawBody();
    const name = `legacy-body-${randomUUID().slice(0, 8)}`;
    database
      .prepare(
        `INSERT INTO skill_registry
          (name, description, owner, source_harness, risk_tier, dispatch_status, completeness_pct, trust_level, signature, content_hash, imported_at)
         VALUES (?, '', 'ops', 'claude', 'low', 'enabled', 100, 'signed', 'sig', ?, datetime('now'))`,
      )
      .run(name, "a".repeat(64));
    const result = lookupSkillContract(database, name, { sourceHarness: "claude", requireSigned: true });
    expect(result?.kind).toBe("hit");
  });

  it("denies quarantined dispatch_status with quarantined label", () => {
    const database = freshDb();
    const name = `quarantine-b26-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name, dispatchStatus: "quarantined" });
    const result = lookupSkillContract(database, name, { sourceHarness: "claude" });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") return;
    expect(result.reason).toMatch(/quarantined/i);
  });

  it("returns ambiguous when multiple harnesses share a skill name", () => {
    const database = freshDb();
    const name = `ambiguous-b26-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name, harness: "claude" });
    insertSkill(database, { name, harness: "codex" });
    const result = lookupSkillContract(database, name);
    expect(result?.kind).toBe("ambiguous");
  });

  it("legacy trust-level signature lookup still accepts third-arg options", () => {
    const database = freshDb();
    const name = `legacy-trust-b26-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name, signature: null });
    const result = lookupSkillContract(database, name, "signed", { requireSigned: true });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") return;
    expect(result.reason).toMatch(/unsigned/i);
  });
});
