// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildSkillEvidence, lookupSkillContract, parseTrustLevel } from "@/lib/dispatch/skill-lookup";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("skill-lookup batch13b — trust parsing and dispatch gates", () => {
  it("parseTrustLevel normalizes valid values and rejects unknown tokens", () => {
    expect(parseTrustLevel("VERIFIED")).toBe("verified");
    expect(parseTrustLevel(" signed ")).toBe("signed");
    expect(parseTrustLevel("bogus")).toBeNull();
    expect(parseTrustLevel(undefined)).toBeNull();
  });

  it("lookupSkillContract denies dispatch when completeness is below threshold", () => {
    const database = freshDb();
    const name = `incomplete-${crypto.randomUUID().slice(0, 8)}`;
    database
      .prepare(
        `INSERT INTO skill_registry (
          name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level
        ) VALUES (?, '', 'ops', 'claude', 'low', 'enabled', '1.0.0', '', '', '', '', 'body', 50, '["x"]', 'op', ?, '', ?, 'unsigned')`
      )
      .run(name, new Date().toISOString(), "a".repeat(64));
    const result = lookupSkillContract(database, name, { sourceHarness: "claude" });
    expect(result?.kind).toBe("denied");
    expect(result && "reason" in result ? result.reason : "").toMatch(/incomplete/i);
  });

  it("lookupSkillContract honors minTrustLevel threshold", () => {
    const database = freshDb();
    const name = `unsigned-${crypto.randomUUID().slice(0, 8)}`;
    database
      .prepare(
        `INSERT INTO skill_registry (
          name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level, lifecycle_state
        ) VALUES (?, '', 'ops', 'claude', 'low', 'enabled', '1.0.0', 'p', 't', 'v', 'r', 'body', 100, '[]', 'op', ?, 'e', ?, 'unsigned', 'enabled')`
      )
      .run(name, new Date().toISOString(), "b".repeat(64));
    const result = lookupSkillContract(database, name, {
      sourceHarness: "claude",
      minTrustLevel: "signed",
    });
    expect(result?.kind).toBe("denied");
    expect(result && "reason" in result ? result.reason : "").toMatch(/trust/i);
  });

  it("lookupSkillContract rejects quarantined skills", () => {
    const database = freshDb();
    const name = `quarantined-${crypto.randomUUID().slice(0, 8)}`;
    database
      .prepare(
        `INSERT INTO skill_registry (
          name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level
        ) VALUES (?, '', 'ops', 'claude', 'low', 'quarantined', '1.0.0', 'p', 't', 'v', 'r', 'body', 100, '[]', 'op', ?, 'e', ?, 'unsigned')`
      )
      .run(name, new Date().toISOString(), "c".repeat(64));
    const result = lookupSkillContract(database, name, { sourceHarness: "claude" });
    expect(result?.kind).toBe("denied");
    expect(result && "reason" in result ? result.reason : "").toMatch(/quarantine/i);
  });

  it("buildSkillEvidence wraps denied lookup results with governance metadata", () => {
    const database = freshDb();
    const name = `evidence-${crypto.randomUUID().slice(0, 8)}`;
    database
      .prepare(
        `INSERT INTO skill_registry (
          name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level, lifecycle_state
        ) VALUES (?, '', 'ops', 'claude', 'low', 'quarantined', '1.0.0', 'p', 't', 'v', 'r', 'body', 100, '[]', 'op', ?, 'examples', ?, 'unsigned', 'draft')`
      )
      .run(name, new Date().toISOString(), "d".repeat(64));
    const lookup = lookupSkillContract(database, name, { sourceHarness: "claude" });
    const evidence = buildSkillEvidence(lookup, "signed");
    expect(evidence.skill_governance.mode).toBe("governed");
    expect(evidence.skill_governance.required_trust_level).toBe("signed");
    expect(evidence.skill_governance.denial_reason).toBeTruthy();
  });
});
