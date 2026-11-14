// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { initSchema } from "@/lib/db-schema";
import { runIntakePipeline } from "../intake";
import { DEFAULT_SKILLFORGE_CONFIG } from "../types";

describe("skillforge intake batch35b", () => {
  let db: Database.Database;

  afterEach(() => {
    db?.close();
  });

  /**
   * collectTelemetry only emits indexable labels today — redactEntries 166–167
   * needs restricted securityLabels with no public hook.
   */
  it.skip("redactEntries restricted continue (166–167) — collectTelemetry never emits restricted labels", () => {});

  it("runIntakePipeline still collects default telemetry when redaction enabled", () => {
    db = new Database(":memory:");
    initSchema(db);
    db.prepare(
      `INSERT INTO skill_registry (name, source_harness, dispatch_status, version, imported_by, imported_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(`telemetry-b35b-${randomUUID().slice(0, 6)}`, "codex", "enabled", "1.0.0", "operator", new Date().toISOString());

    const result = runIntakePipeline(db, {
      ...DEFAULT_SKILLFORGE_CONFIG,
      redactionEnabled: true,
      minTraceAgeHours: 0,
    });
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.redacted).toBe(0);
  });
});
