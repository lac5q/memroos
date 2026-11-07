// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { runIntakePipeline } from "../intake";
import { DEFAULT_SKILLFORGE_CONFIG } from "../types";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  initSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS eval_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_id TEXT,
      query TEXT NOT NULL,
      expected TEXT,
      actual TEXT,
      passed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);
});

afterEach(() => {
  db.close();
});

describe("SkillForge intake batch23b — eval failure traces", () => {
  it("collects failed eval_candidates rows as failure traces", () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO skill_registry (name, source_harness, dispatch_status, version, imported_by, imported_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("registry-skill", "codex", "enabled", "1.0.0", "test", now);

    db.prepare(
      `INSERT INTO eval_candidates (skill_id, query, expected, actual, passed, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("registry-skill", "what is memroos?", "operator console", "unknown", 0, now);

    const result = runIntakePipeline(db, { ...DEFAULT_SKILLFORGE_CONFIG, minTraceAgeHours: 0 });
    const failure = result.entries.find((e) => e.traceType === "failure");
    expect(failure?.skillId).toBe("registry-skill");
    expect(failure?.payload).toMatchObject({ query: "what is memroos?", passed: false });
  });

  it("skips eval_candidates rows without skill_id", () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO eval_candidates (skill_id, query, expected, actual, passed, created_at)
       VALUES (NULL, ?, ?, ?, ?, ?)`,
    ).run("orphan query", "a", "b", 0, now);

    const result = runIntakePipeline(db, { ...DEFAULT_SKILLFORGE_CONFIG, minTraceAgeHours: 0 });
    expect(result.entries.filter((e) => e.traceType === "failure")).toHaveLength(0);
  });
});
