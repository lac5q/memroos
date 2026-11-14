// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { lookupSkillContract } from "../skill-lookup";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

function insertSkill(
  database: Database.Database,
  opts: {
    name: string;
    harness?: string;
    dispatchStatus: string;
    lifecycle?: string;
    completeness?: number;
    body?: string;
  },
): void {
  const body = opts.body ?? `body-${randomUUID()}`;
  const contentHash = createHash("sha256").update(body, "utf8").digest("hex");
  database
    .prepare(
      `INSERT INTO skill_registry (
        name, description, owner, source_harness, risk_tier, dispatch_status,
        version, preconditions, allowed_tools, verification_checks, rollback_behavior,
        raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
        evidence_examples, content_hash, trust_level, lifecycle_state, signature
      ) VALUES (?, '', 'ops', ?, 'low', ?, '1.0.0', '', '', '', '', ?, ?, '[]', 'op', ?, '', ?, 'signed', ?, 'sig-b37')`,
    )
    .run(
      opts.name,
      opts.harness ?? "claude",
      opts.dispatchStatus,
      body,
      opts.completeness ?? 100,
      new Date().toISOString(),
      contentHash,
      opts.lifecycle ?? "enabled",
    );
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("skill-lookup batch37 — lifecycle retired and dispatch fallback label", () => {
  it.skip("NOT NULL signature sticky path (625) — schema rejects null signature on insert", () => {});

  it("denies retired lifecycle with retired label (618-623)", () => {
    const database = freshDb();
    const name = `retired-b37-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name, dispatchStatus: "enabled", lifecycle: "retired" });
    const result = lookupSkillContract(database, name, { sourceHarness: "claude" });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") return;
    expect(result.reason).toMatch(/retired/i);
  });

  it("denies dispatch_status incomplete label (609-610)", () => {
    const database = freshDb();
    const name = `disp-inc-b37-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name, dispatchStatus: "incomplete", completeness: 100 });
    const result = lookupSkillContract(database, name, { sourceHarness: "claude" });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") return;
    expect(result.reason).toMatch(/incomplete/i);
  });

  it.skip("raw dispatch_status fallback label (624-625) — CHECK constraint prevents unknown dispatch_status values in registry", () => {});
});