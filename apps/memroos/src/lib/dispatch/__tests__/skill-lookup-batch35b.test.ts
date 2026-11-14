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
  opts: {
    name: string;
    harness?: string;
    dispatchStatus: string;
    lifecycle?: string;
    completeness?: number;
    body?: string;
    trust?: string;
    version?: string;
    signature?: string | null;
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
      ) VALUES (?, '', 'ops', ?, 'low', ?, ?, '', '', '', '', ?, ?, '[]', 'op', ?, '', ?, ?, ?, ?)`,
    )
    .run(
      opts.name,
      opts.harness ?? "claude",
      opts.dispatchStatus,
      opts.version ?? "1.0.0",
      body,
      opts.completeness ?? 100,
      new Date().toISOString(),
      contentHash,
      opts.trust ?? "signed",
      opts.lifecycle ?? "enabled",
      opts.signature === undefined ? "sig-b35b" : opts.signature,
    );
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("skill-lookup batch35b — denial labels and evidence arms", () => {
  it("denies version mismatch explicitly (480-488)", () => {
    const database = freshDb();
    const name = `ver-b35b-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name, dispatchStatus: "enabled", version: "2.0.0" });
    const result = lookupSkillContract(database, name, { sourceHarness: "claude", version: "1.0.0" });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") return;
    expect(result.reason).toMatch(/version mismatch/i);
  });

  it("surfaces quarantined dispatch_status label (613-617)", () => {
    const database = freshDb();
    const name = `quar-b35b-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name, dispatchStatus: "quarantined" });
    const result = lookupSkillContract(database, name, { sourceHarness: "claude" });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") return;
    expect(result.reason).toMatch(/quarantined/i);
  });

  it("surfaces under review dispatch_status label (611-612)", () => {
    const database = freshDb();
    const name = `review-b35b-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name, dispatchStatus: "review" });
    const result = lookupSkillContract(database, name, { sourceHarness: "claude" });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") return;
    expect(result.reason).toMatch(/under review/i);
  });

  it("denies when minTrustLevel exceeds row trust (502-511)", () => {
    const database = freshDb();
    const name = `trust-b35b-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name, dispatchStatus: "enabled", trust: "unsigned" });
    const result = lookupSkillContract(database, name, {
      sourceHarness: "claude",
      minTrustLevel: "signed",
    });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") return;
    expect(result.reason).toMatch(/below required minimum/i);
  });

  it("lookupSkillContract returns ambiguous without harness binding (399-409)", () => {
    const database = freshDb();
    const name = `ambig-b35b-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name, harness: "claude", dispatchStatus: "enabled" });
    insertSkill(database, { name, harness: "codex", dispatchStatus: "enabled" });
    const result = lookupSkillContract(database, name);
    expect(result?.kind).toBe("ambiguous");
    if (result?.kind !== "ambiguous") return;
    const evidence = buildSkillEvidence(result);
    expect(evidence.skill_governance?.denial_reason).toMatch(/multiple harnesses/i);
  });

  it("denies deprecated lifecycle with lifecycle label (618-623)", () => {
    const database = freshDb();
    const name = `depr-b35b-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name, dispatchStatus: "enabled", lifecycle: "deprecated" });
    const result = lookupSkillContract(database, name, { sourceHarness: "claude" });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") return;
    expect(result.reason).toMatch(/deprecated/i);
  });
});
