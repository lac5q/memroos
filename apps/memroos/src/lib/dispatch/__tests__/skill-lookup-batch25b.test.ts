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
  opts: { name: string; lifecycle?: string; body?: string; contentHash?: string },
): void {
  const body = opts.body ?? `body-${randomUUID()}`;
  const contentHash = opts.contentHash ?? createHash("sha256").update(body, "utf8").digest("hex");
  database
    .prepare(
      `INSERT INTO skill_registry (
        name, description, owner, source_harness, risk_tier, dispatch_status,
        version, preconditions, allowed_tools, verification_checks, rollback_behavior,
        raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
        evidence_examples, content_hash, trust_level, lifecycle_state, signature
      ) VALUES (?, '', 'ops', 'claude', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'signed', ?, 'sig-b25b')`,
    )
    .run(opts.name, body, new Date().toISOString(), contentHash, opts.lifecycle ?? "enabled");
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("skill-lookup batch25b — lifecycle and body integrity", () => {
  it("denies enabled rows whose lifecycle_state is not enabled", () => {
    const database = freshDb();
    const name = `lifecycle-b25b-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name, lifecycle: "draft" });
    const result = lookupSkillContract(database, name, { sourceHarness: "claude" });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") return;
    expect(result.reason).toMatch(/lifecycle/i);
  });

  it("denies signed rows when raw_body hash does not match content_hash", () => {
    const database = freshDb();
    const name = `tamper-b25b-${randomUUID().slice(0, 8)}`;
    const body = "intact-body-batch25b";
    insertSkill(database, { name, body, contentHash: "a".repeat(64) });
    const result = lookupSkillContract(database, name, { sourceHarness: "claude", requireSigned: true });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") return;
    expect(result.reason).toMatch(/body|hash|integrity/i);
  });
});
