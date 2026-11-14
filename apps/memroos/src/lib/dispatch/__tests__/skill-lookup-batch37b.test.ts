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
  opts: { name: string; version?: string; body?: string },
): string {
  const body = opts.body ?? `body-${randomUUID()}`;
  const contentHash = createHash("sha256").update(body, "utf8").digest("hex");
  database
    .prepare(
      `INSERT INTO skill_registry (
        name, description, owner, source_harness, risk_tier, dispatch_status,
        version, preconditions, allowed_tools, verification_checks, rollback_behavior,
        raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
        evidence_examples, content_hash, trust_level, lifecycle_state, signature
      ) VALUES (?, '', 'ops', 'claude', 'low', 'enabled', ?, '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'signed', 'enabled', 'sig-b37b')`,
    )
    .run(opts.name, opts.version ?? "1.0.0", body, new Date().toISOString(), contentHash);
  return contentHash;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("skill-lookup batch37b — pinned version mismatch", () => {
  it("denies pinned skills when registry version differs (282-290)", () => {
    const database = freshDb();
    const name = `pin-ver-b37b-${randomUUID().slice(0, 8)}`;
    const hash = insertSkill(database, { name, version: "2.1.0" });
    const result = lookupSkillContract(database, name, {
      sourceHarness: "claude",
      pinned: {
        agent_id: "agent-b37b",
        source_harness: "claude",
        current_version: "9.9.9",
        current_content_hash: hash,
      },
    });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") return;
    expect(result.reason).toMatch(/version mismatch/i);
  });
});