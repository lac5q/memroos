// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildSkillEvidence, lookupSkillContract, parseTrustLevel } from "../skill-lookup";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

function insertSkill(
  database: Database.Database,
  opts: { name: string; harness: string; dispatchStatus?: string; completeness?: number },
): void {
  const body = `body-${randomUUID()}`;
  const contentHash = createHash("sha256").update(body, "utf8").digest("hex");
  database
    .prepare(
      `INSERT INTO skill_registry (
        name, description, owner, source_harness, risk_tier, dispatch_status,
        version, preconditions, allowed_tools, verification_checks, rollback_behavior,
        raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
        evidence_examples, content_hash, trust_level, signature, lifecycle_state
      ) VALUES (?, '', 'ops', ?, 'low', ?, '1.0.0', '', '', '', '', ?, ?, '[]', 'op', ?, '', ?, 'unsigned', NULL, 'enabled')`,
    )
    .run(
      opts.name,
      opts.harness,
      opts.dispatchStatus ?? "enabled",
      body,
      opts.completeness ?? 100,
      new Date().toISOString(),
      contentHash,
    );
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("skill-lookup batch17b — trust parsing and evidence blocks", () => {
  it("parseTrustLevel accepts canonical values and rejects unknown labels", () => {
    expect(parseTrustLevel("Verified")).toBe("verified");
    expect(parseTrustLevel(" signed ")).toBe("signed");
    expect(parseTrustLevel("gold")).toBeNull();
    expect(parseTrustLevel(null)).toBeNull();
  });

  it("lookupSkillContract returns null for empty skill name", () => {
    const database = freshDb();
    expect(lookupSkillContract(database, "  ")).toBeNull();
  });

  it("lookupSkillContract returns ambiguous when multiple harnesses share a name", () => {
    const database = freshDb();
    const name = `ambig-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name, harness: "claude" });
    insertSkill(database, { name, harness: "codex" });
    const result = lookupSkillContract(database, name);
    expect(result?.kind).toBe("ambiguous");
    if (result?.kind === "ambiguous") {
      expect(result.candidate_harnesses.sort()).toEqual(["claude", "codex"]);
    }
  });

  it("buildSkillEvidence surfaces denial and required trust level", () => {
    const denied = buildSkillEvidence(
      {
        kind: "denied",
        skill_name: "demo",
        reason: "incomplete",
        dispatch_status: "incomplete",
        trust_level: "unsigned",
      },
      "signed",
    );
    expect(denied.skill_governance.denial_reason).toBe("incomplete");
    expect(denied.skill_governance.required_trust_level).toBe("signed");

    const fallback = buildSkillEvidence(null, "verified");
    expect(fallback.skill_governance.mode).toBe("fallback");
    expect(fallback.skill_governance.required_trust_level).toBe("verified");
  });
});
