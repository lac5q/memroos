// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildSkillEvidence, lookupSkillContract } from "../skill-lookup";

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
    dispatchStatus: string;
    lifecycle?: string;
    completeness?: number;
    signature?: string | null;
    trust?: string;
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
        evidence_examples, content_hash, trust_level, lifecycle_state, signature
      ) VALUES (?, '', 'ops', ?, 'low', ?, '1.0.0', '', '', '', '', ?, ?, '[]', 'op', ?, '', ?, ?, ?, ?)`,
    )
    .run(
      opts.name,
      opts.harness ?? "claude",
      opts.dispatchStatus,
      body,
      opts.completeness ?? 100,
      new Date().toISOString(),
      contentHash,
      opts.trust ?? "signed",
      opts.lifecycle ?? "enabled",
      opts.signature === undefined ? "sig-b35" : opts.signature,
    );
}

function legacyDbNoLifecycle(): Database.Database {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE skill_registry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      owner TEXT,
      source_harness TEXT,
      risk_tier TEXT,
      dispatch_status TEXT,
      version TEXT,
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

describe("skill-lookup batch35 — legacy enabled query, lifecycle labels, evidence", () => {
  it("legacy enabled lookup without sourceHarness uses minimal SQL (470)", () => {
    const database = legacyDbNoLifecycle();
    const name = `legacy-noharness-b35-${randomUUID().slice(0, 8)}`;
    const body = `legacy-body-b35-${randomUUID()}`;
    const hash = createHash("sha256").update(body, "utf8").digest("hex");
    database
      .prepare(
        `INSERT INTO skill_registry
          (name, description, owner, source_harness, risk_tier, dispatch_status, completeness_pct, trust_level, signature, content_hash, raw_body, imported_at)
         VALUES (?, '', 'ops', 'claude', 'low', 'enabled', 100, 'unsigned', 'sig', ?, ?, datetime('now'))`,
      )
      .run(name, hash, body);
    const result = lookupSkillContract(database, name);
    expect(result?.kind).toBe("hit");
  });

  it("denies draft lifecycle with draft-specific label (618-620)", () => {
    const database = freshDb();
    const name = `draft-b35-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name, dispatchStatus: "enabled", lifecycle: "draft" });
    const result = lookupSkillContract(database, name, { sourceHarness: "claude" });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") return;
    expect(result.reason).toMatch(/draft lifecycle/i);
  });

  it.skip("dispatch_status ?? unknown fallback (625) — column NOT NULL with enum CHECK", () => {});

  it("denies unsigned rows when requireSigned (583) and maps denied evidence (672)", () => {
    const database = freshDb();
    const name = `unsigned-b35-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name, dispatchStatus: "enabled", signature: null });
    const denied = lookupSkillContract(database, name, { sourceHarness: "claude", requireSigned: true });
    expect(denied?.kind).toBe("denied");
    const evidence = buildSkillEvidence(denied);
    expect(evidence.skill_governance?.mode).toBe("governed");
    expect(evidence.skill_governance?.denial_reason).toMatch(/unsigned/i);
  });

  it("buildSkillEvidence fallback mode without minTrustLevel (662)", () => {
    const evidence = buildSkillEvidence(null);
    expect(evidence.skill_governance?.mode).toBe("fallback");
    expect(evidence.skill_governance?.required_trust_level).toBeUndefined();
  });
});
