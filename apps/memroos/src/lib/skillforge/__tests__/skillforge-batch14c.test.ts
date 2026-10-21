// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  publishSkill,
  searchListings,
} from "../marketplace";
import { applyApprovalAction, markApplied, rollbackProposal } from "../operator-approval";

const TMP = path.join(os.tmpdir(), `skillforge-b14c-${crypto.randomUUID()}`);

function marketplaceDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE skill_registry (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      owner TEXT,
      source_harness TEXT NOT NULL DEFAULT 'claude',
      risk_tier TEXT,
      dispatch_status TEXT NOT NULL DEFAULT 'enabled',
      version TEXT,
      preconditions TEXT,
      allowed_tools TEXT,
      verification_checks TEXT,
      rollback_behavior TEXT,
      raw_body TEXT NOT NULL DEFAULT '',
      completeness_pct INTEGER NOT NULL DEFAULT 100,
      missing_fields_json TEXT NOT NULL DEFAULT '[]',
      imported_by TEXT NOT NULL DEFAULT 'operator',
      imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      evidence_examples TEXT,
      content_hash TEXT,
      signature TEXT,
      signed_by TEXT,
      signed_at TEXT,
      trust_level TEXT NOT NULL DEFAULT 'unsigned',
      public_key_fingerprint TEXT,
      lifecycle_state TEXT NOT NULL DEFAULT 'enabled',
      UNIQUE(name, source_harness)
    );
    CREATE TABLE skill_quarantine (skill_id INTEGER PRIMARY KEY, stage TEXT NOT NULL);
    CREATE TABLE skill_marketplace (
      id TEXT PRIMARY KEY, skill_id TEXT NOT NULL, name TEXT NOT NULL,
      description TEXT NOT NULL, author TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]',
      version TEXT NOT NULL, changelog TEXT NOT NULL DEFAULT '', rating REAL NOT NULL DEFAULT 0,
      review_count INTEGER NOT NULL DEFAULT 0, download_count INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL, published_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      deprecated INTEGER NOT NULL DEFAULT 0, deprecation_reason TEXT
    );
    CREATE TABLE skill_reviews (
      id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, reviewer TEXT NOT NULL,
      rating INTEGER NOT NULL, text TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

function operatorDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE skillforge_proposals (
      id TEXT PRIMARY KEY, seal_proposal_id TEXT, source_skill_id TEXT NOT NULL,
      source_version TEXT NOT NULL, proposed_diff TEXT NOT NULL, status TEXT NOT NULL,
      train_split_id TEXT, validation_results TEXT, held_out_results TEXT, w_delta REAL,
      rejected_edits TEXT NOT NULL DEFAULT '[]', residual_risks TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE skillforge_exports (
      id INTEGER PRIMARY KEY, proposal_id TEXT NOT NULL, pre_version TEXT, pre_hash TEXT,
      pre_raw_body TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE skill_registry (
      id INTEGER PRIMARY KEY, version TEXT, content_hash TEXT, raw_body TEXT, imported_at TEXT
    );
    CREATE TABLE audit_entries (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, actor_id TEXT NOT NULL, actor_role TEXT NOT NULL,
      event_type TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      reason TEXT, metadata_json TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE seal_audit_log (proposal_id TEXT, event TEXT, detail TEXT, timestamp TEXT);
  `);
  return db;
}

let dbDir: string;

beforeEach(() => {
  fs.mkdirSync(TMP, { recursive: true });
  dbDir = path.join(TMP, `db-${crypto.randomUUID()}`);
  fs.mkdirSync(dbDir, { recursive: true });
  process.env.MEMROOS_ROOT = dbDir;
  process.env.SQLITE_DB_PATH = path.join(dbDir, "skillforge.db");
});

afterEach(() => {
  delete process.env.MEMROOS_ROOT;
  delete process.env.SQLITE_DB_PATH;
});

describe("skillforge batch14c — marketplace, operator approval, intake-export", () => {
  it("publishSkill resolves numeric registry ids and harness-qualified names", () => {
    const db = marketplaceDb();
    const body = "numeric skill body";
    const bodyHash = createHash("sha256").update(body, "utf8").digest("hex");
    db.prepare(
      `INSERT INTO skill_registry (id, name, source_harness, dispatch_status, raw_body, imported_by, version, content_hash, lifecycle_state, completeness_pct)
       VALUES (42, 'numeric-skill', 'claude', 'enabled', ?, 'operator', '1.0.0', ?, 'enabled', 100)`,
    ).run(body, bodyHash);
    const byId = publishSkill(db, {
      skillId: "42",
      name: "Numeric",
      description: "d",
      author: "a",
      tags: [],
      category: "ops",
      changelog: "",
    });
    expect(byId.success).toBe(true);

    const harnessBody = "harness skill body";
    const harnessHash = createHash("sha256").update(harnessBody, "utf8").digest("hex");
    db.prepare(
      `INSERT INTO skill_registry (name, source_harness, dispatch_status, raw_body, imported_by, version, content_hash, lifecycle_state, completeness_pct)
       VALUES ('harness-skill', 'codex', 'enabled', ?, 'operator', '2.0.0', ?, 'enabled', 100)`,
    ).run(harnessBody, harnessHash);
    // publishSkill listing ids are `market-${Date.now()}` without a random suffix,
    // so two publishes in the same millisecond collide on the PK.
    const started = Date.now();
    while (Date.now() === started) {
      /* spin until the clock ticks */
    }
    const byHarness = publishSkill(db, {
      skillId: "harness-skill",
      sourceHarness: "codex",
      name: "Harness",
      description: "d",
      author: "a",
      tags: [],
      category: "ops",
      changelog: "",
    });
    expect(byHarness).toMatchObject({ success: true });
    const { listings } = searchListings(db, { query: "Harness" });
    expect(listings.some((l) => l.name === "Harness")).toBe(true);
  });

  it("applyApprovalAction rollback without pre_raw_body still reports restored metadata", () => {
    const db = operatorDb();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO skill_registry (id, version, content_hash, raw_body, imported_at) VALUES (1, '1.0.0', ?, 'body', ?)`).run(
      "0".repeat(64),
      now,
    );
    db.prepare(
      `INSERT INTO skillforge_proposals
       (id, seal_proposal_id, source_skill_id, source_version, proposed_diff, status, rejected_edits, residual_risks, created_at, updated_at)
       VALUES ('p-no-body', 'seal', '1', '1.0.0', 'diff', 'applied', '[]', '[]', ?, ?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO skillforge_exports (proposal_id, pre_version, pre_hash, pre_raw_body, created_at)
       VALUES ('p-no-body', '0.9.0', ?, NULL, ?)`,
    ).run("1".repeat(64), now);

    const result = applyApprovalAction(db, {
      proposalId: "p-no-body",
      action: "rollback",
      operator: "operator",
      reasoning: "undo",
    });
    expect(result.success).toBe(true);
    expect(result.restored).toBe(true);
    expect(result.postVersion).toBe("0.9.0");
  });

  it("rollbackProposal and markApplied surface guard errors", () => {
    const db = operatorDb();
    expect(rollbackProposal(db, "missing", "operator").error).toMatch(/not found/i);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO skillforge_proposals
       (id, source_skill_id, source_version, proposed_diff, status, rejected_edits, residual_risks, created_at, updated_at)
       VALUES ('p-wrong', '1', '1.0.0', 'diff', 'pending', '[]', '[]', ?, ?)`,
    ).run(now, now);
    expect(markApplied(db, "p-wrong").error).toMatch(/approved/);
  });

  it("intake-export exportProposal validates runtime actor and version fields", async () => {
    const { exportProposal, SkillForgeIntakeError } = await import("../intake-export");
    const { getDb } = await import("@/lib/db");
    const db = getDb();
    expect(() =>
      exportProposal(db, {
        proposalId: `prop-${crypto.randomUUID()}`,
        runtimeSkillId: "skill",
        runtimeVersion: " ",
        runtimeContentHash: "0".repeat(64),
        actor: "operator",
      }),
    ).toThrow(SkillForgeIntakeError);
    expect(() =>
      exportProposal(db, {
        proposalId: `prop-${crypto.randomUUID()}`,
        runtimeSkillId: "skill",
        runtimeVersion: "1.0.0",
        runtimeContentHash: "0".repeat(64),
        actor: " ",
      }),
    ).toThrow(/actor is required/);
  });
});
