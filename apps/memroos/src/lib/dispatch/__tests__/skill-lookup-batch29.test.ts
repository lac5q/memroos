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
    harness: string;
    dispatchStatus?: string;
    completeness?: number;
    lifecycle?: string | null;
    trust?: string;
    signature?: string | null;
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
      ) VALUES (?, '', 'ops', ?, 'low', ?, '1.0.0', '', '', '', '', ?, ?, '[]', 'op', ?, '', ?, ?, ?, ?)`,
    )
    .run(
      opts.name,
      opts.harness,
      opts.dispatchStatus ?? "enabled",
      body,
      opts.completeness ?? 100,
      new Date().toISOString(),
      contentHash,
      opts.trust ?? "signed",
      opts.lifecycle ?? "enabled",
      opts.signature === undefined ? "sig-b29" : opts.signature,
    );
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("skill-lookup batch29 — legacy any-row SQL and lifecycle denial labels", () => {
  it("falls back when lifecycle_state column is missing from any-contract query", () => {
    const database = freshDb();
    database.exec(`ALTER TABLE skill_registry DROP COLUMN lifecycle_state`);

    const name = `legacy-fallback-b29-${randomUUID().slice(0, 8)}`;
    const body = `body-${randomUUID()}`;
    const contentHash = createHash("sha256").update(body, "utf8").digest("hex");
    database
      .prepare(
        `INSERT INTO skill_registry (
        name, description, owner, source_harness, risk_tier, dispatch_status,
        version, preconditions, allowed_tools, verification_checks, rollback_behavior,
        raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
        evidence_examples, content_hash, trust_level, signature
      ) VALUES (?, '', 'ops', ?, 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, ?, ?)`,
      )
      .run(name, "claude", body, new Date().toISOString(), contentHash, "signed", "sig-b29");

    const result = lookupSkillContract(database, name, { sourceHarness: "claude" });
    expect(result?.kind).toBe("hit");
  });

  it("surfaces deprecated lifecycle when dispatch is enabled and complete", () => {
    const database = freshDb();
    const name = `deprecated-b29-${randomUUID().slice(0, 8)}`;
    insertSkill(database, {
      name,
      harness: "codex",
      lifecycle: "deprecated",
    });

    const result = lookupSkillContract(database, name, { sourceHarness: "codex" });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") return;
    expect(result.reason).toMatch(/deprecated/);
  });
});
