// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { buildSkillEvidence, lookupSkillContract } from "@/lib/dispatch/skill-lookup";

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
  database
    .prepare(
      `INSERT INTO skill_registry (
        name, description, owner, source_harness, risk_tier, dispatch_status,
        version, preconditions, allowed_tools, verification_checks, rollback_behavior,
        raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
        evidence_examples, content_hash, trust_level, signature, lifecycle_state
      ) VALUES (?, '', 'ops', ?, 'low', ?, '1.0.0', '', '', '', '', 'body', ?, '[]', 'op', ?, '', ?, ?, ?, ?)`,
    )
    .run(
      opts.name,
      opts.harness,
      opts.dispatchStatus ?? "enabled",
      opts.completeness ?? 100,
      new Date().toISOString(),
      "a".repeat(64),
      opts.trust ?? "unsigned",
      opts.signature ?? null,
      opts.lifecycle ?? "enabled",
    );
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("skill-lookup batch15b", () => {
  it("returns ambiguous when multiple harnesses share a skill name", () => {
    const database = freshDb();
    const name = `ambiguous-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name, harness: "claude" });
    insertSkill(database, { name, harness: "codex" });
    const result = lookupSkillContract(database, name);
    expect(result?.kind).toBe("ambiguous");
    if (result?.kind === "ambiguous") {
      expect(result.candidate_harnesses.sort()).toEqual(["claude", "codex"]);
      const evidence = buildSkillEvidence(result, "signed");
      expect(evidence.skill_governance.required_trust_level).toBe("signed");
    }
  });

  it("labels quarantined and lifecycle-blocked contracts in denial reasons", () => {
    const database = freshDb();
    const quarantined = `quar-${randomUUID().slice(0, 8)}`;
    insertSkill(database, {
      name: quarantined,
      harness: "claude",
      dispatchStatus: "quarantined",
    });
    const quar = lookupSkillContract(database, quarantined, { sourceHarness: "claude" });
    expect(quar?.kind).toBe("denied");
    expect(quar && "reason" in quar ? quar.reason : "").toMatch(/quarantined/i);

    const draftName = `draft-${randomUUID().slice(0, 8)}`;
    insertSkill(database, {
      name: draftName,
      harness: "claude",
      dispatchStatus: "enabled",
      lifecycle: "draft",
    });
    const draft = lookupSkillContract(database, draftName, { sourceHarness: "claude" });
    expect(draft && "reason" in draft ? draft.reason : "").toMatch(/draft lifecycle/i);
  });

  it("buildSkillEvidence maps denied rows with dispatch metadata", () => {
    const denied = {
      kind: "denied" as const,
      skill_name: "x",
      reason: "blocked",
      dispatch_status: "review",
      trust_level: "unsigned" as const,
    };
    const evidence = buildSkillEvidence(denied, "verified");
    expect(evidence.skill_governance.denied_dispatch_status).toBe("review");
    expect(evidence.skill_governance.required_trust_level).toBe("verified");
  });
});
