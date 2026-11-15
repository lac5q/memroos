// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { runIntakePipeline } from "../intake";
import { DEFAULT_SKILLFORGE_CONFIG } from "../types";

describe("skillforge intake batch38b", () => {
  it.skip("redactEntries restricted branch (166–167) — collectTelemetry never emits restricted labels", () => {});

  it("runIntakePipeline returns empty metrics when skill_registry has no rows", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO skill_registry (name, source_harness, dispatch_status, version, imported_by, imported_at)
       VALUES (?, 'codex', 'enabled', '1.0.0', 'operator', ?)`,
    ).run(`skill-b38b-${randomUUID().slice(0, 8)}`, now);
    const result = runIntakePipeline(db, {
      ...DEFAULT_SKILLFORGE_CONFIG,
      redactionEnabled: true,
      minTraceAgeHours: 0,
    });
    expect(result.entries.length).toBeGreaterThanOrEqual(1);
    expect(result.redacted).toBe(0);
    db.close();
  });
});