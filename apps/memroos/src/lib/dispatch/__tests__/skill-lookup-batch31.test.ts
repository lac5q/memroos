// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildSkillEvidence, lookupSkillContract } from "../skill-lookup";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

function insertSkill(
  database: Database.Database,
  opts: { name: string; harness: string; dispatchStatus: string; lifecycle?: string; completeness?: number },
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
      ) VALUES (?, '', 'ops', ?, 'low', ?, '1.0.0', '', '', '', '', ?, ?, '[]', 'op', ?, '', ?, 'signed', ?, 'sig-b31')`,
    )
    .run(
      opts.name,
      opts.harness,
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

describe("skill-lookup batch31 — dispatch_status fallback label and governed evidence", () => {
  it("denies incomplete contracts before dispatch_status fallback (step 5)", () => {
    const database = freshDb();
    const name = `incomplete-b31-${randomUUID().slice(0, 8)}`;
    insertSkill(database, {
      name,
      harness: "codex",
      dispatchStatus: "enabled",
      lifecycle: "enabled",
      completeness: 80,
    });
    const result = lookupSkillContract(database, name, { sourceHarness: "codex" });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") return;
    expect(result.reason).toMatch(/incomplete/);
  });

  it("buildSkillEvidence maps ambiguous conflicts with required_trust_level", () => {
    const database = freshDb();
    const name = `ambiguous-b31-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name, harness: "claude", dispatchStatus: "enabled" });
    insertSkill(database, { name, harness: "codex", dispatchStatus: "enabled" });
    const result = lookupSkillContract(database, name);
    expect(result?.kind).toBe("ambiguous");
    const evidence = buildSkillEvidence(result, "signed");
    expect(evidence.skill_governance?.denial_reason).toBeTruthy();
    expect(evidence.skill_governance?.required_trust_level).toBe("signed");
  });

  it("buildSkillEvidence includes required_trust_level on governed hits", () => {
    const database = freshDb();
    const name = `hit-b31-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name, harness: "claude", dispatchStatus: "enabled" });
    const hit = lookupSkillContract(database, name, { sourceHarness: "claude" });
    expect(hit?.kind).toBe("hit");
    const evidence = buildSkillEvidence(hit, "verified");
    expect(evidence.skill_governance?.required_trust_level).toBe("verified");
    expect(evidence.skill_governance?.selected_skill?.name).toBe(name);
  });
});
