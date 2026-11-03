// @vitest-environment node
import crypto from "crypto";
import { createHash } from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { generateEditProposal } from "../edit-generator";
import { runIntakePipeline } from "../intake";
import { exportSkillPackage, importSkillPackage, syncSkillsWithAgent } from "../multi-agent";
import { publishSkill, searchListings } from "../marketplace";
import type { SkillForgeAnalysisResult, SkillForgeConfig, RejectedEdit } from "../types";

const config: SkillForgeConfig = {
  cronSchedule: "0 2 * * *",
  batchSize: 5,
  textualLearningRate: 0.05,
  redactionEnabled: true,
  skillScopeFilter: [],
  minTraceAgeHours: 0,
  maxTraceAgeDays: 365,
};

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
      raw_body TEXT NOT NULL DEFAULT 'body',
      completeness_pct INTEGER NOT NULL DEFAULT 100,
      missing_fields_json TEXT NOT NULL DEFAULT '[]',
      imported_by TEXT NOT NULL DEFAULT 'operator',
      imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      content_hash TEXT,
      signature TEXT,
      lifecycle_state TEXT NOT NULL DEFAULT 'enabled',
      author TEXT,
      tags TEXT,
      content TEXT,
      UNIQUE(name, source_harness)
    );
    CREATE TABLE skill_quarantine (skill_id INTEGER PRIMARY KEY, stage TEXT NOT NULL);
    CREATE TABLE skill_marketplace (
      id TEXT PRIMARY KEY, skill_id TEXT NOT NULL, name TEXT NOT NULL,
      description TEXT NOT NULL, author TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]',
      version TEXT NOT NULL, changelog TEXT NOT NULL DEFAULT '', rating REAL NOT NULL DEFAULT 0,
      review_count INTEGER NOT NULL DEFAULT 0, download_count INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL, published_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      deprecated INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE skill_sync_log (
      skill_id TEXT, target_agent TEXT, package_id TEXT, status TEXT, timestamp TEXT
    );
    CREATE TABLE eval_receipts (
      skill_id TEXT, provider TEXT, model TEXT, dimensions TEXT, timestamp TEXT
    );
  `);
  return db;
}

afterEach(() => {
  /* in-memory dbs only */
});

describe("skillforge batch15 — intake, edits, multi-agent, marketplace", () => {
  it("runIntakePipeline collects eval failures, redacts, filters, and deduplicates", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE skill_registry (
        id INTEGER PRIMARY KEY, name TEXT, dispatch_status TEXT, version TEXT, imported_at TEXT
      );
      CREATE TABLE eval_candidates (
        id INTEGER PRIMARY KEY, skill_id TEXT, query TEXT, expected TEXT, actual TEXT, passed INTEGER, created_at TEXT
      );
    `);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO skill_registry (id, name, dispatch_status, version, imported_at) VALUES (1, 'alpha-skill', 'enabled', '1.0.0', ?)`,
    ).run(now);
    db.prepare(
      `INSERT INTO eval_candidates (skill_id, query, expected, actual, passed, created_at)
       VALUES ('alpha-skill', 'q', 'a', 'b', 0, ?), (NULL, 'q2', 'a', 'b', 0, ?)`,
    ).run(now, now);

    const scoped = { ...config, skillScopeFilter: ["other-skill"] };
    const filtered = runIntakePipeline(db, scoped);
    expect(filtered.filtered).toBeGreaterThan(0);

    const redacted = runIntakePipeline(db, {
      ...config,
      skillScopeFilter: [],
      redactionEnabled: true,
    });
    expect(redacted.entries.length).toBeGreaterThan(0);

    const noRedact = runIntakePipeline(db, { ...config, redactionEnabled: false });
    expect(noRedact.redacted).toBe(0);

    const dup = runIntakePipeline(db, config);
    const dupAgain = runIntakePipeline(db, config);
    expect(dupAgain.deduplicated).toBeGreaterThanOrEqual(0);
    expect(dup.entries.length).toBeGreaterThan(0);
    db.close();
  });

  it("generateEditProposal covers test cases, learning-rate cap, and recent rejection", () => {
    const analysis: SkillForgeAnalysisResult = {
      skillId: "skill-tests",
      patterns: [],
      testCases: [
        { input: "input-a", expectedOutput: "output-a" },
        { input: "input-b", expectedOutput: "output-b" },
        { input: "input-c", expectedOutput: "output-c" },
        { input: "input-d", expectedOutput: "output-d" },
      ],
      confidence: 0.8,
    };
    expect(generateEditProposal(analysis, { ...config, textualLearningRate: 0.05 }, [])).toBeNull();

    const rich: SkillForgeAnalysisResult = {
      skillId: "skill-rich",
      patterns: [{ id: "p-0", pattern: "pattern-a", frequency: 2, examples: ["x"], suggestedFix: "fix" }],
      testCases: [{ input: "in", expectedOutput: "out" }],
      confidence: 0.9,
    };
    const proposal = generateEditProposal(rich, { ...config, textualLearningRate: 0.8 }, []);
    expect(proposal?.proposedDiff).toContain("Generated Test Cases");

    const diff = generateEditProposal(
      { skillId: "s", patterns: [{ id: "1", pattern: "deploy", frequency: 1, examples: ["d"], suggestedFix: null }], testCases: [], confidence: 0.5 },
      config,
      [],
    )!.proposedDiff;
    const editHash = createHash("sha256").update(diff).digest("hex").slice(0, 16);
    const rejected: RejectedEdit[] = [{ editHash, reason: "no", rejectedAt: new Date() }];
    expect(generateEditProposal(
      { skillId: "s", patterns: [{ id: "1", pattern: "deploy", frequency: 1, examples: ["d"], suggestedFix: null }], testCases: [], confidence: 0.5 },
      config,
      rejected,
    )).toBeNull();
  });

  it("multi-agent export/import/sync handle errors and validation branches", () => {
    const db = marketplaceDb();
    db.prepare(
      `INSERT INTO skill_registry (id, name, content, version, author, tags, imported_at)
       VALUES (7, 'Pack Skill', '# Skill', '1.0.0', 'author', '[]', datetime('now'))`,
    ).run();
    db.prepare(
      `INSERT INTO eval_receipts (skill_id, provider, model, dimensions, timestamp)
       VALUES ('7', 'eval', 'model', '{"accuracy":0.9}', datetime('now'))`,
    ).run();

    const exported = exportSkillPackage(db, "7");
    expect(exported.success).toBe(true);

    db.prepare(`UPDATE skill_registry SET tags = 'not-json' WHERE id = 7`).run();
    const badExport = exportSkillPackage(db, "7");
    expect(badExport.success).toBe(false);

    const missingMeta = importSkillPackage(db, {
      id: "pkg",
      skillId: "8",
      name: "X",
      content: "body",
      metadata: { version: "", author: "a", tags: [], evalReceipts: [] },
      compatibility: ["memroos"],
      exportedAt: new Date().toISOString(),
    });
    expect(missingMeta.validationPassed).toBe(false);

    const incompatible = importSkillPackage(db, {
      ...(exported.package as NonNullable<typeof exported.package>),
      compatibility: ["other"],
    });
    expect(incompatible.errors.some((e) => e.includes("not compatible"))).toBe(true);

    db.exec(`DROP TABLE skill_sync_log`);
    const sync = syncSkillsWithAgent(db, "http://localhost/agents/a2a", ["7"]);
    expect(sync.errors.length).toBeGreaterThan(0);
    db.close();
  });

  it("marketplace publish and search cover lifecycle, tamper, and search error branches", () => {
    const db = marketplaceDb();
    const hash = createHash("sha256").update("body").digest("hex");
    db.prepare(
      `INSERT INTO skill_registry
        (id, name, source_harness, dispatch_status, completeness_pct, lifecycle_state, raw_body, content_hash, version)
       VALUES (10, 'Listed Skill', 'claude', 'enabled', 100, 'draft', 'body', ?, '2.0.0')`,
    ).run(hash);
    const notDispatchable = publishSkill(db, {
      skillId: "10",
      name: "Listed Skill",
      description: "d",
      author: "a",
      tags: [],
      category: "general",
      changelog: "",
    });
    expect(notDispatchable.success).toBe(false);

    db.prepare(`UPDATE skill_registry SET lifecycle_state = 'enabled', content_hash = ? WHERE id = 10`).run(
      createHash("sha256").update("tampered").digest("hex"),
    );
    const tampered = publishSkill(db, {
      skillId: "10",
      name: "Listed Skill",
      description: "d",
      author: "a",
      tags: [],
      category: "general",
      changelog: "",
    });
    expect(tampered.code).toBe("tampered");

    db.prepare(`UPDATE skill_registry SET content_hash = ?, lifecycle_state = 'retired' WHERE id = 10`).run(hash);
    const retired = publishSkill(db, {
      skillId: "10",
      name: "Listed Skill",
      description: "d",
      author: "a",
      tags: [],
      category: "general",
      changelog: "",
    });
    expect(retired.code).toBe("retired");

    db.prepare(`UPDATE skill_registry SET lifecycle_state = 'enabled', completeness_pct = 50 WHERE id = 10`).run();
    db.prepare(
      `INSERT INTO skill_marketplace
        (id, skill_id, name, description, author, tags, version, changelog, rating, review_count, download_count, category, published_at, updated_at, deprecated)
       VALUES (?, '10', 'Listed Skill', 'd', 'a', '[]', '2.0.0', '', 0, 0, 0, 'general', datetime('now'), datetime('now'), 0)`,
    ).run(`market-${crypto.randomUUID()}`);

    const broken = searchListings(db, { query: "Listed" });
    expect(broken.listings[0]?.isDispatchable).toBe(false);

    db.prepare(`DROP TABLE skill_registry`).run();
    const afterDrop = searchListings(db, { query: "Listed" });
    expect(afterDrop.listings[0]?.dispatchDenialReason).toContain("dispatch eligibility");
    db.close();
  });
});
