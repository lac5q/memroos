// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { checkDispatchEligibility, publishGovernedSkill } from "../marketplace";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

function insertRow(
  database: Database.Database,
  opts: {
    name: string;
    dispatchStatus?: string;
    lifecycle?: string | null;
    completeness?: number;
    body?: string;
    hash?: string;
  },
): number {
  const body = opts.body ?? `body-b35b-${randomUUID()}`;
  const hash = opts.hash ?? createHash("sha256").update(body, "utf8").digest("hex");
  const result = database
    .prepare(
      `INSERT INTO skill_registry (
        name, description, owner, source_harness, risk_tier, dispatch_status,
        version, preconditions, allowed_tools, verification_checks, rollback_behavior,
        raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
        evidence_examples, content_hash, trust_level, lifecycle_state, signature
      ) VALUES (?, '', 'ops', 'claude', 'low', ?, '1.0.0', '', '', '', '', ?, ?, '[]', 'op', ?, '', ?, 'signed', ?, 'sig')`,
    )
    .run(
      opts.name,
      opts.dispatchStatus ?? "enabled",
      body,
      opts.completeness ?? 100,
      new Date().toISOString(),
      hash,
      opts.lifecycle === undefined ? "enabled" : opts.lifecycle,
    );
  return Number(result.lastInsertRowid);
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("skillforge marketplace batch35b — eligibility branches", () => {
  it("checkDispatchEligibility detects tampered content_hash (232-239)", () => {
    const database = freshDb();
    const name = `tamper-b35b-${randomUUID().slice(0, 8)}`;
    insertRow(database, { name, hash: "deadbeef".repeat(8) });
    const row = database
      .prepare(
        `SELECT id, name, source_harness, dispatch_status, completeness_pct, lifecycle_state, content_hash, raw_body, signature, version
         FROM skill_registry WHERE name = ? LIMIT 1`,
      )
      .get(name) as Parameters<typeof checkDispatchEligibility>[0];
    const eligibility = checkDispatchEligibility(row);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reason).toMatch(/tamper detected/i);
  });

  it("checkDispatchEligibility rejects retired lifecycle (225-227)", () => {
    const database = freshDb();
    const name = `retired-b35b-${randomUUID().slice(0, 8)}`;
    insertRow(database, { name, lifecycle: "retired" });
    const row = database
      .prepare(
        `SELECT id, name, source_harness, dispatch_status, completeness_pct, lifecycle_state, content_hash, raw_body, signature, version
         FROM skill_registry WHERE name = ? LIMIT 1`,
      )
      .get(name) as Parameters<typeof checkDispatchEligibility>[0];
    const eligibility = checkDispatchEligibility(row);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reason).toMatch(/retired/i);
  });

  it("publishGovernedSkill throws ambiguous_harness when name collides (165-171)", () => {
    const database = freshDb();
    const name = `ambig-b35b-${randomUUID().slice(0, 8)}`;
    insertRow(database, { name });
    database
      .prepare(
        `INSERT INTO skill_registry (
          name, description, owner, source_harness, risk_tier, dispatch_status,
          version, raw_body, completeness_pct, imported_by, imported_at, content_hash, trust_level, lifecycle_state, signature
        ) VALUES (?, '', 'ops', 'codex', 'low', 'enabled', '1.0.0', 'body2', 100, 'op', ?, ?, 'signed', 'enabled', 'sig')`,
      )
      .run(name, new Date().toISOString(), createHash("sha256").update("body2").digest("hex"));
    const result = publishGovernedSkill(
      database,
      name,
      {
        name: "Listed B35B",
        description: "d",
        author: "a",
        tags: [],
        category: "general",
        changelog: "c",
      },
      {},
    );
    expect(result.success).toBe(false);
    expect(result.code).toBe("ambiguous_harness");
  });
});
