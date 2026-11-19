/**
 * SkillForge Marketplace tests — Phase 92
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { publishSkill, searchListings, submitReview, recordDownload, deprecateSkill, checkDispatchEligibility, publishGovernedSkill } from "../marketplace";

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

function registerSkill(db: Database.Database, name: string, version: string = '1.0.0'): void {
  db.prepare(
    `INSERT INTO skill_registry (name, source_harness, dispatch_status, raw_body, imported_by, version) VALUES (?, 'claude', 'enabled', ?, 'operator', ?)`
  ).run(name, `body-${name}`, version);
}

describe("marketplace", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  it("publishes a skill", () => {
    registerSkill(db, "skill-1");
    const result = publishSkill(db, {
      skillId: "skill-1",
      name: "Test Skill",
      description: "A test skill",
      author: "tester",
      tags: ["test"],
      category: "testing",
      changelog: "Initial release",
    });
    expect(result.success).toBe(true);
    expect(result.listingId).toBeTruthy();
  });

  it("searches listings by query", () => {
    registerSkill(db, "s1");
    registerSkill(db, "s2");
    publishSkill(db, { skillId: "s1", name: "Alpha", description: "First skill", author: "a", tags: [], category: "cat", changelog: "" });
    publishSkill(db, { skillId: "s2", name: "Beta", description: "Second skill", author: "a", tags: [], category: "cat", changelog: "" });

    const results = searchListings(db, { query: "Alpha" });
    expect(results.total).toBe(1);
    expect(results.listings[0].name).toBe("Alpha");
  });

  it("submits a review and updates rating", () => {
    registerSkill(db, "s1");
    const pub = publishSkill(db, { skillId: "s1", name: "Skill", description: "Desc", author: "a", tags: [], category: "cat", changelog: "" });

    const review = submitReview(db, pub.listingId!, { reviewer: "user1", rating: 5, text: "Great!", verified: true });
    expect(review.success).toBe(true);

    const results = searchListings(db, {});
    expect(results.listings[0].rating).toBe(5);
    expect(results.listings[0].reviewCount).toBe(1);
  });

  it("records downloads", () => {
    registerSkill(db, "s1");
    const pub = publishSkill(db, { skillId: "s1", name: "Skill", description: "Desc", author: "a", tags: [], category: "cat", changelog: "" });
    recordDownload(db, pub.listingId!);

    const results = searchListings(db, {});
    expect(results.listings[0].downloadCount).toBe(1);
  });

  it("deprecates a skill", () => {
    registerSkill(db, "s1");
    const pub = publishSkill(db, { skillId: "s1", name: "Skill", description: "Desc", author: "a", tags: [], category: "cat", changelog: "" });
    deprecateSkill(db, pub.listingId!, "Outdated");

    const results = searchListings(db, {});
    expect(results.total).toBe(0);
  });

  it("searches with category, minRating, and sortBy downloads", () => {
    registerSkill(db, "sort-a");
    registerSkill(db, "sort-b");
    const pubA = publishSkill(db, { skillId: "sort-a", name: "Alpha Tool", description: "First", author: "a", tags: [], category: "tools", changelog: "" });
    publishSkill(db, { skillId: "sort-b", name: "Beta Tool", description: "Second", author: "a", tags: [], category: "other", changelog: "" });
    submitReview(db, pubA.listingId!, { reviewer: "u1", rating: 5, text: "Great", verified: true });
    recordDownload(db, pubA.listingId!);
    recordDownload(db, pubA.listingId!);

    const byCategory = searchListings(db, { category: "tools" });
    expect(byCategory.total).toBe(1);
    expect(byCategory.listings[0].name).toBe("Alpha Tool");

    const byRating = searchListings(db, { minRating: 4 });
    expect(byRating.total).toBe(1);

    const byDownloads = searchListings(db, { sortBy: "downloads" });
    expect(byDownloads.listings[0].downloadCount).toBeGreaterThanOrEqual(2);
  });

  it("checkDispatchEligibility rejects retired lifecycle and tampered hashes", () => {
    const retired = checkDispatchEligibility({
      id: 1,
      name: "retired-skill",
      source_harness: "claude",
      dispatch_status: "enabled",
      completeness_pct: 100,
      lifecycle_state: "retired",
      raw_body: "body",
      content_hash: "abc",
    } as never);
    expect(retired.eligible).toBe(false);
    expect(retired.reason).toMatch(/retired/i);

    const tampered = checkDispatchEligibility({
      id: 2,
      name: "tampered-skill",
      source_harness: "claude",
      dispatch_status: "enabled",
      completeness_pct: 100,
      lifecycle_state: "enabled",
      raw_body: "actual body",
      content_hash: "f".repeat(64),
    } as never);
    expect(tampered.eligible).toBe(false);
    expect(tampered.reason).toMatch(/tamper detected/i);
  });

  it("checkDispatchEligibility reports missing registry rows and disabled dispatch", () => {
    const enabledRow = db.prepare(
      `SELECT id, name, source_harness, dispatch_status, completeness_pct, lifecycle_state, content_hash, raw_body, signature, version
         FROM skill_registry WHERE name = ?`
    ).get("s1") as {
      id: number;
      name: string;
      source_harness: string;
      dispatch_status: string | null;
      completeness_pct: number | null;
      lifecycle_state: string | null;
      content_hash: string | null;
      raw_body: string | null;
      signature: string | null;
      version: string | null;
    } | undefined;
    registerSkill(db, "dispatch-check");
    const row = db.prepare(
      `SELECT id, name, source_harness, dispatch_status, completeness_pct, lifecycle_state, content_hash, raw_body, signature, version
         FROM skill_registry WHERE name = ?`
    ).get("dispatch-check") as NonNullable<typeof enabledRow>;
    expect(checkDispatchEligibility(row).eligible).toBe(true);
    expect(checkDispatchEligibility(null).eligible).toBe(false);

    db.prepare(`UPDATE skill_registry SET dispatch_status = 'disabled' WHERE name = ?`).run("dispatch-check");
    const disabled = db.prepare(
      `SELECT id, name, source_harness, dispatch_status, completeness_pct, lifecycle_state, content_hash, raw_body, signature, version
         FROM skill_registry WHERE name = ?`
    ).get("dispatch-check") as NonNullable<typeof enabledRow>;
    expect(checkDispatchEligibility(disabled).eligible).toBe(false);
    void enabledRow;
  });

  it("publishGovernedSkill resolves numeric registry ids", () => {
    registerSkill(db, "numeric-skill", "2.1.0");
    const registryId = db.prepare(`SELECT id FROM skill_registry WHERE name = ?`).get("numeric-skill") as { id: number };
    const result = publishGovernedSkill(
      db,
      String(registryId.id),
      {
        name: "Numeric Skill",
        description: "Published by registry id",
        author: "tester",
        tags: ["numeric"],
        category: "testing",
        changelog: "by id",
      }
    );
    expect(result.success).toBe(true);
    const listing = db.prepare(`SELECT skill_id, version FROM skill_marketplace WHERE id = ?`).get(result.listingId!) as {
      skill_id: string;
      version: string;
    };
    expect(listing.skill_id).toBe(String(registryId.id));
    expect(listing.version).toBe("2.1.0");
  });

  it("searchListings tolerates invalid tags JSON", () => {
    registerSkill(db, "bad-tags");
    const pub = publishSkill(db, {
      skillId: "bad-tags",
      name: "Bad Tags",
      description: "Desc",
      author: "a",
      tags: ["x"],
      category: "cat",
      changelog: "",
    });
    db.prepare(`UPDATE skill_marketplace SET tags = 'not-json' WHERE id = ?`).run(pub.listingId!);
    const results = searchListings(db, { query: "Bad Tags" });
    expect(results.listings[0].tags).toEqual([]);
  });

  it("rejects publish when the registry row is incomplete or missing", () => {
    const missing = publishSkill(db, {
      skillId: "missing-skill",
      name: "Missing",
      description: "Desc",
      author: "a",
      tags: [],
      category: "cat",
      changelog: "",
    });
    expect(missing.success).toBe(false);
    expect(missing.code).toBe("skill_not_found");

    registerSkill(db, "incomplete");
    db.prepare(`UPDATE skill_registry SET completeness_pct = 50 WHERE name = ?`).run("incomplete");
    const incomplete = publishSkill(db, {
      skillId: "incomplete",
      name: "Incomplete",
      description: "Desc",
      author: "a",
      tags: [],
      category: "cat",
      changelog: "",
    });
    expect(incomplete.success).toBe(false);
    expect(incomplete.error).toMatch(/incomplete/i);
  });

  it("deprecates an existing listing and hides it from search", () => {
    registerSkill(db, "deprecate-me");
    const pub = publishSkill(db, {
      skillId: "deprecate-me",
      name: "Deprecate Me",
      description: "Desc",
      author: "a",
      tags: [],
      category: "cat",
      changelog: "",
    });
    const result = deprecateSkill(db, pub.listingId!, "retired");
    expect(result.success).toBe(true);
    expect(searchListings(db, { query: "Deprecate Me" }).total).toBe(0);
  });

  it("getListing returns null for unknown ids and deprecate rejects missing listings", () => {
    const result = deprecateSkill(db, "missing-listing", "gone");
    expect(result.success).toBe(true);
  });

  it("publishSkill fails when skill name exists in multiple harnesses", () => {
    db.prepare(
      `INSERT INTO skill_registry (name, source_harness, dispatch_status, raw_body, imported_by, version)
       VALUES ('ambig', 'claude', 'enabled', 'b', 'op', '1.0.0')`
    ).run();
    db.prepare(
      `INSERT INTO skill_registry (name, source_harness, dispatch_status, raw_body, imported_by, version)
       VALUES ('ambig', 'codex', 'enabled', 'b', 'op', '1.0.0')`
    ).run();
    const result = publishSkill(db, {
      skillId: "ambig",
      name: "Ambig",
      description: "Desc",
      author: "a",
      tags: [],
      category: "cat",
      changelog: "",
    });
    expect(result.success).toBe(false);
    expect(result.code).toBe("ambiguous_harness");
  });

  it("searchListings flags orphan listings as not dispatchable", () => {
    db.prepare(
      `INSERT INTO skill_marketplace
       (id, skill_id, name, description, author, tags, version, changelog, rating, review_count, download_count, category, published_at, updated_at, deprecated)
       VALUES ('orphan', 'ghost-skill', 'Ghost', 'd', 'a', '[]', '1.0.0', '', 0, 0, 0, 'cat', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 0)`
    ).run();
    const results = searchListings(db, { query: "Ghost" });
    expect(results.listings[0].isDispatchable).toBe(false);
    expect(results.listings[0].dispatchDenialReason).toMatch(/not found/);
  });

  it("publishSkill rejects empty skillId via governance binding", () => {
    const missingId = publishSkill(db, {
      skillId: " ",
      name: "X",
      description: "Desc",
      author: "a",
      tags: [],
      category: "cat",
      changelog: "",
    });
    expect(missingId.success).toBe(false);
    expect(missingId.code).toBe("missing_skill_id");
  });
});
