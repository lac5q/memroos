// @vitest-environment node
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { LifecycleTransitionError, transitionLifecycleState } from "../skill-lifecycle";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

function insertSkill(database: Database.Database, lifecycle: string): number {
  const name = `life-b32-${crypto.randomUUID().slice(0, 8)}`;
  const body = `body-${crypto.randomUUID()}`;
  return Number(
    database
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level, lifecycle_state)
         VALUES (?, '', 'ops', 'memroos', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned', ?)`,
      )
      .run(
        name,
        body,
        new Date().toISOString(),
        crypto.createHash("sha256").update(body).digest("hex"),
        lifecycle,
      )
      .lastInsertRowid,
  );
}

afterEach(() => {
  db?.close();
  db = null;
  vi.restoreAllMocks();
});

describe("skill-lifecycle batch32 — invalid registry state and audit probe errors", () => {
  // sticky: loadLifecycleState invalid enum return (407) — SQLite CHECK blocks non-enum lifecycle_state writes.

  it("transitionLifecycleState treats missing registry rows as invalid lifecycle (line 407 parity)", () => {
    const database = freshDb();
    expect(() => transitionLifecycleState(database, 9_999_999, "enabled", "operator-b32", "missing")).toThrow(
      LifecycleTransitionError,
    );
  });

  it("appendUnifiedAuditEntry swallows sqlite_master probe failures (line 349)", () => {
    const database = freshDb();
    const skillId = insertSkill(database, "enabled");
    const originalPrepare = database.prepare.bind(database);
    vi.spyOn(database, "prepare").mockImplementation((sql: string) => {
      if (sql.includes("sqlite_master") && sql.includes("audit_entries")) {
        throw new Error("sqlite_master probe fail b32");
      }
      const stmt = originalPrepare(sql);
      if (sql.includes("INSERT INTO audit_entries")) {
        return {
          ...stmt,
          run: () => {
            throw new Error("audit insert fail b32");
          },
        } as ReturnType<typeof database.prepare>;
      }
      return stmt;
    });

    const result = transitionLifecycleState(database, skillId, "deprecated", "operator-b32", "deprecate batch32");
    expect(result.lifecycle_state).toBe("deprecated");
  });
});
