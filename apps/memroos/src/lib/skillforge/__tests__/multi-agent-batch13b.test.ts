// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { exportSkillPackage, importSkillPackage, syncSkillsWithAgent, type SkillPackage } from "../multi-agent";

function setupDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE skill_registry (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, content TEXT NOT NULL,
      version TEXT, author TEXT, tags TEXT, imported_at TEXT
    );
    CREATE TABLE eval_receipts (
      id INTEGER PRIMARY KEY, skill_id TEXT, provider TEXT, model TEXT,
      dimensions TEXT, timestamp TEXT
    );
    CREATE TABLE skill_sync_log (
      id INTEGER PRIMARY KEY, skill_id TEXT, target_agent TEXT,
      package_id TEXT, status TEXT, timestamp TEXT
    );
  `);
  return db;
}

let db: Database.Database;

beforeEach(() => {
  db = setupDb();
});

afterEach(() => {
  db.close();
});

function validPackage(overrides: Partial<SkillPackage> = {}): SkillPackage {
  return {
    id: `pkg-${crypto.randomUUID()}`,
    skillId: "999",
    name: "imported-skill",
    content: "skill body",
    metadata: {
      version: "1.0.0",
      author: "operator",
      tags: ["test"],
      evalReceipts: [
        {
          provider: "local",
          model: "eval",
          dimensions: { quality: 0.9 },
          timestamp: new Date().toISOString(),
        },
      ],
    },
    compatibility: ["memroos", "codex"],
    exportedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("multi-agent batch13b — package validation paths", () => {
  it("exportSkillPackage returns error when skill id is missing", () => {
    const result = exportSkillPackage(db, "404");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Skill not found");
  });

  it("importSkillPackage rejects packages missing required fields", () => {
    const result = importSkillPackage(db, validPackage({ skillId: "", content: "" }));
    expect(result.success).toBe(false);
    expect(result.validationPassed).toBe(false);
    expect(result.errors.some((e) => e.includes("Missing required fields"))).toBe(true);
  });

  it("importSkillPackage rejects incompatible frameworks", () => {
    const result = importSkillPackage(db, validPackage({ compatibility: ["codex"] }));
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("not compatible"))).toBe(true);
  });

  it("importSkillPackage rejects eval receipts below threshold", () => {
    const result = importSkillPackage(
      db,
      validPackage({
        metadata: {
          version: "1.0.0",
          author: "operator",
          tags: [],
          evalReceipts: [
            { provider: "local", model: "eval", dimensions: { quality: 0.2 }, timestamp: "2026-01-01T00:00:00Z" },
          ],
        },
      })
    );
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("Eval validation failed"))).toBe(true);
  });

  it("syncSkillsWithAgent logs pending sync rows for exported skills", () => {
    db.prepare(
      "INSERT INTO skill_registry (id, name, content, version, author, tags, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(1, "Test", "content", "1.0", "author", "[]", new Date().toISOString());
    const sync = syncSkillsWithAgent(db, "http://localhost/agents/peer", ["1"]);
    expect(sync.synced).toBe(1);
    expect(sync.errors).toHaveLength(0);
    const logged = db.prepare("SELECT COUNT(*) AS c FROM skill_sync_log").get() as { c: number };
    expect(logged.c).toBe(1);
  });
});
