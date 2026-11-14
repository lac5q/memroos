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
  opts: { name: string; harness: string; trust?: string; signature?: string | null },
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
      ) VALUES (?, '', 'ops', ?, 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, ?, 'enabled', ?)`,
    )
    .run(
      opts.name,
      opts.harness,
      body,
      new Date().toISOString(),
      contentHash,
      opts.trust ?? "signed",
      opts.signature === undefined ? "sig-b28" : opts.signature,
    );
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("skill-lookup batch28 — ambiguity and trust floor", () => {
  it("returns ambiguous when the same skill name exists in multiple harnesses", () => {
    const database = freshDb();
    const name = `ambig-b28-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name, harness: "claude" });
    insertSkill(database, { name, harness: "codex" });
    const result = lookupSkillContract(database, name);
    expect(result?.kind).toBe("ambiguous");
  });

  it("denies rows below minTrustLevel even when dispatch is enabled", () => {
    const database = freshDb();
    const name = `unsigned-b28-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name, harness: "claude", trust: "unsigned", signature: null });
    const result = lookupSkillContract(database, name, {
      sourceHarness: "claude",
      minTrustLevel: "signed",
    });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") return;
    expect(result.reason).toMatch(/minimum 'signed'/i);
  });
});
