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
    dispatchStatus: string;
    lifecycle?: string;
  },
): void {
  const body = `body-${randomUUID()}`;
  const contentHash = createHash("sha256").update(body, "utf8").digest("hex");
  database
    .prepare(
      `INSERT INTO skill_registry (
        name, description, owner, source_harness, risk_tier, dispatch_status,
        version, preconditions, allowed_tools, verification_checks, rollback_behavior,
        raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
        evidence_examples, content_hash, trust_level, lifecycle_state, signature
      ) VALUES (?, '', 'ops', 'claude', 'low', ?, '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'signed', ?, 'sig-b32')`,
    )
    .run(
      opts.name,
      opts.dispatchStatus,
      body,
      new Date().toISOString(),
      contentHash,
      opts.lifecycle ?? "enabled",
    );
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("skill-lookup batch32 — supply-chain denial labels", () => {
  // sticky: dispatch_status ?? "unknown" fallback (625) — column is NOT NULL with enum CHECK.

  it("denies quarantined contracts with the mandatory quarantine label (lines 613-617)", () => {
    const database = freshDb();
    const name = `quar-b32-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name, dispatchStatus: "quarantined", lifecycle: "enabled" });
    const result = lookupSkillContract(database, name, { sourceHarness: "claude" });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") return;
    expect(result.reason).toContain("quarantined");
    expect(result.dispatch_status).toBe("quarantined");
  });
});
