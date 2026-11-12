// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import {
  checkDispatchEligibility,
  deprecateSkill,
  publishSkill,
  recordDownload,
  searchListings,
  submitReview,
} from "../marketplace";

function setupDb(): Database.Database {
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
    CREATE TABLE skill_quarantine (
      skill_id INTEGER PRIMARY KEY,
      stage TEXT NOT NULL
    );
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

describe("marketplace batch13", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  it("publishSkill rejects ambiguous harness names", () => {
    db.prepare(
      `INSERT INTO skill_registry (name, source_harness, dispatch_status, raw_body, imported_by, version)
       VALUES ('dup-name', 'claude', 'enabled', 'body', 'operator', '1.0.0'),
              ('dup-name', 'codex', 'enabled', 'body', 'operator', '2.0.0')`
    ).run();
    const result = publishSkill(db, {
      skillId: "dup-name",
      name: "Dup",
      description: "d",
      author: "a",
      tags: [],
      category: "cat",
      changelog: "",
    });
    expect(result.success).toBe(false);
    expect(result.code).toBe("ambiguous_harness");
  });

  it("searchListings marks listings non-dispatchable when quarantine rejected", () => {
    db.prepare(
      `INSERT INTO skill_registry (id, name, source_harness, dispatch_status, raw_body, imported_by, version, lifecycle_state, content_hash)
       VALUES (7, 'q-skill', 'claude', 'enabled', 'body', 'operator', '1.0.0', 'enabled', ?)`
    ).run("0".repeat(64));
    db.prepare(`INSERT INTO skill_quarantine (skill_id, stage) VALUES (7, 'rejected')`).run();
    db.prepare(
      `INSERT INTO skill_marketplace
       (id, skill_id, name, description, author, tags, version, changelog, rating, review_count, download_count, category, published_at, updated_at, deprecated)
       VALUES ('m1', '7', 'Q Skill', 'd', 'a', '[]', '1.0.0', '', 0, 0, 0, 'cat', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 0)`
    ).run();
    const { listings } = searchListings(db, {});
    expect(listings[0]?.isDispatchable).toBe(false);
    expect(listings[0]?.dispatchDenialReason).toMatch(/quarantine stage='rejected'/);
  });

  it("checkDispatchEligibility reports missing registry row", () => {
    expect(checkDispatchEligibility(null).eligible).toBe(false);
  });

  it("submitReview, recordDownload, and deprecateSkill surface errors on missing tables", () => {
    const broken = new Database(":memory:");
    expect(submitReview(broken, "missing", { reviewer: "u", rating: 5, text: "x", verified: false }).success).toBe(
      false
    );
    recordDownload(broken, "missing");
    expect(deprecateSkill(broken, "missing", "reason").success).toBe(false);
  });
});
