// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { DEFAULT_SKILLFORGE_CONFIG } from "../types";
import { runIntakePipeline } from "../intake";

let db: Database.Database | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS eval_candidates (
      id INTEGER PRIMARY KEY,
      skill_id TEXT,
      query TEXT,
      expected TEXT,
      actual TEXT,
      passed INTEGER,
      created_at TEXT
    );
  `);
  return db;
}

describe("skillforge intake batch19", () => {
  it("deduplicates identical eval failure traces within one intake run", () => {
    const database = freshDb();
    const now = new Date().toISOString();
    database.prepare(
      `INSERT INTO skill_registry (name, source_harness, dispatch_status, version, imported_by, imported_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("dup-skill-b19", "codex", "enabled", "1.0.0", "operator", now);
    database.prepare(
      `INSERT INTO eval_candidates (skill_id, query, expected, actual, passed, created_at)
       VALUES (?, ?, ?, ?, 0, ?), (?, ?, ?, ?, 0, ?)`,
    ).run("dup-skill-b19", "same-q", "same-e", "same-a", now, "dup-skill-b19", "same-q", "same-e", "same-a", now);

    const config = {
      ...DEFAULT_SKILLFORGE_CONFIG,
      redactionEnabled: true,
      minTraceAgeHours: 0,
      maxTraceAgeDays: 3650,
    };
    const result = runIntakePipeline(database, config);
    expect(result.deduplicated).toBe(1);
    expect(result.entries.some((entry) => entry.traceType === "failure")).toBe(true);
  });

  it("redaction stays disabled when config.redactionEnabled is false", () => {
    const database = freshDb();
    const now = new Date().toISOString();
    database.prepare(
      `INSERT INTO skill_registry (name, source_harness, dispatch_status, version, imported_by, imported_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("plain-skill-b19", "codex", "enabled", "1.0.0", "operator", now);
    const result = runIntakePipeline(database, {
      ...DEFAULT_SKILLFORGE_CONFIG,
      redactionEnabled: false,
      minTraceAgeHours: 0,
    });
    expect(result.redacted).toBe(0);
    expect(result.entries.length).toBeGreaterThan(0);
  });
});
