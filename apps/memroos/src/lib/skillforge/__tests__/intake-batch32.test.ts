// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { runIntakePipeline } from "../intake";
import { DEFAULT_SKILLFORGE_CONFIG } from "../types";

describe("skillforge intake batch32", () => {
  let db: Database.Database;

  afterEach(() => {
    db?.close();
  });

  it("runIntakePipeline keeps default telemetry when redaction is enabled", () => {
    db = new Database(":memory:");
    initSchema(db);
    db.prepare(
      `INSERT INTO skill_registry (name, source_harness, dispatch_status, version, imported_by, imported_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("telemetry-b32", "codex", "enabled", "1.0.0", "operator", new Date().toISOString());

    const result = runIntakePipeline(db, {
      ...DEFAULT_SKILLFORGE_CONFIG,
      redactionEnabled: true,
      minTraceAgeHours: 0,
    });
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.redacted).toBe(0);
  });

  /**
   * redactEntries lines 166–167 require restricted securityLabels, but
   * collectTelemetry only emits indexable labels — no public hook without
   * production change.
   */
  it.skip("redactEntries restricted branch (166–167) — labels not emitted by collectTelemetry", () => {});
});
