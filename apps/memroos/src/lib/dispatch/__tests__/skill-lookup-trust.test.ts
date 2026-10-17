// @vitest-environment node
/**
 * Additional skill-lookup coverage: parseTrustLevel, legacy signatures,
 * quarantine labels, version binding, requireSigned, artifact integrity,
 * and buildSkillEvidence edge shapes.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

import { computeContentHash } from "@/lib/skills/registry";

const TEST_DB_DIR = path.join(os.tmpdir(), `skill-lookup-trust-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "trust.db");

async function loadModules() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  const { getDb, closeDb } = await import("@/lib/db");
  const { initSchema } = await import("@/lib/db-schema");
  const db = getDb();
  initSchema(db);
  return { closeDb, db };
}

function insertSkill(
  db: import("better-sqlite3").Database,
  overrides: Partial<{
    name: string;
    source_harness: string;
    dispatch_status: string;
    completeness_pct: number;
    version: string;
    raw_body: string;
    lifecycle_state: string;
    signature: string | null;
    trust_level: string;
    content_hash: string | null;
  }> = {},
) {
  const rawBody = overrides.raw_body ?? "## Preconditions\nnone";
  const row = {
    name: overrides.name ?? "test-skill",
    source_harness: overrides.source_harness ?? "claude",
    risk_tier: "low",
    dispatch_status: overrides.dispatch_status ?? "enabled",
    completeness_pct: overrides.completeness_pct ?? 100,
    lifecycle_state:
      overrides.lifecycle_state ??
      ((overrides.dispatch_status ?? "enabled") === "enabled" ? "enabled" : "draft"),
    owner: "team-a",
    description: "A test skill",
    version: overrides.version ?? "1.0",
    raw_body: rawBody,
    missing_fields_json: "[]",
    preconditions: "none",
    allowed_tools: "read_file",
    verification_checks: "check output",
    rollback_behavior: "no-op",
    imported_by: "operator",
    imported_at: new Date().toISOString(),
    evidence_examples: "check output",
    signature: overrides.signature ?? null,
    trust_level: overrides.trust_level ?? "unsigned",
    content_hash: overrides.content_hash ?? computeContentHash(rawBody),
  };

  db.prepare(
    `INSERT OR REPLACE INTO skill_registry
      (name, source_harness, risk_tier, dispatch_status, completeness_pct,
       owner, description, version, raw_body, missing_fields_json,
       preconditions, allowed_tools, verification_checks, rollback_behavior,
       imported_by, imported_at, evidence_examples, signature, trust_level, content_hash, lifecycle_state)
     VALUES
      (@name, @source_harness, @risk_tier, @dispatch_status, @completeness_pct,
       @owner, @description, @version, @raw_body, @missing_fields_json,
       @preconditions, @allowed_tools, @verification_checks, @rollback_behavior,
       @imported_by, @imported_at, @evidence_examples, @signature, @trust_level, @content_hash, @lifecycle_state)`,
  ).run(row);
}

let db: import("better-sqlite3").Database;
let closeDb: () => void;

beforeEach(async () => {
  fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  const mods = await loadModules();
  db = mods.db;
  closeDb = mods.closeDb;
});

afterEach(() => {
  closeDb();
  fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
});

describe("parseTrustLevel", () => {
  it("accepts canonical trust tiers case-insensitively and rejects unknown values", async () => {
    const { parseTrustLevel } = await import("../skill-lookup");
    expect(parseTrustLevel("verified")).toBe("verified");
    expect(parseTrustLevel(" Signed ")).toBe("signed");
    expect(parseTrustLevel(undefined)).toBeNull();
    expect(parseTrustLevel("super-trusted")).toBeNull();
  });
});

describe("lookupSkillContract governance branches", () => {
  it("returns null for blank skill names", async () => {
    const { lookupSkillContract } = await import("../skill-lookup");
    expect(lookupSkillContract(db, null)).toBeNull();
    expect(lookupSkillContract(db, "   ")).toBeNull();
  });

  it("surfaces quarantined supply-chain status in denials", async () => {
    const { lookupSkillContract } = await import("../skill-lookup");
    insertSkill(db, {
      name: "quarantined-skill",
      dispatch_status: "quarantined",
      completeness_pct: 100,
    });
    const result = lookupSkillContract(db, "quarantined-skill");
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") throw new Error("narrow");
    expect(result.reason).toMatch(/quarantined/i);
  });

  it("denies explicit version mismatches on otherwise enabled rows", async () => {
    const { lookupSkillContract } = await import("../skill-lookup");
    insertSkill(db, { name: "versioned", version: "2.0.0" });
    const result = lookupSkillContract(db, "versioned", {
      sourceHarness: "claude",
      version: "1.0.0",
    });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") throw new Error("narrow");
    expect(result.reason).toMatch(/version mismatch/i);
  });

  it("denies unsigned rows when requireSigned is set (legacy third-arg shape)", async () => {
    const { lookupSkillContract } = await import("../skill-lookup");
    insertSkill(db, { name: "unsigned-enabled" });
    const result = lookupSkillContract(db, "unsigned-enabled", null, { requireSigned: true });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") throw new Error("narrow");
    expect(result.reason).toMatch(/unsigned/i);
  });

  it("denies signed rows whose content_hash no longer matches raw_body", async () => {
    const { lookupSkillContract } = await import("../skill-lookup");
    const body = "## Signed body\ncontent";
    insertSkill(db, {
      name: "tampered-signed",
      raw_body: body,
      signature: "deadbeef",
      trust_level: "signed",
      content_hash: "f".repeat(64),
    });
    const result = lookupSkillContract(db, "tampered-signed");
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") throw new Error("narrow");
    expect(result.reason).toMatch(/artifact integrity/i);
  });

  it("supports legacy minTrustLevel as the second positional argument", async () => {
    const { lookupSkillContract } = await import("../skill-lookup");
    insertSkill(db, { name: "low-trust", trust_level: "unsigned" });
    const result = lookupSkillContract(db, "low-trust", "signed");
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") throw new Error("narrow");
    expect(result.reason).toMatch(/trust level/i);
  });
});

describe("buildSkillEvidence extended shapes", () => {
  it("records required_trust_level on ambiguous and denied results", async () => {
    const { buildSkillEvidence, lookupSkillContract } = await import("../skill-lookup");
    insertSkill(db, { name: "shared-name", source_harness: "claude" });
    insertSkill(db, { name: "shared-name", source_harness: "codex" });
    const ambiguous = lookupSkillContract(db, "shared-name");
    expect(ambiguous?.kind).toBe("ambiguous");
    const ambiguousEvidence = buildSkillEvidence(ambiguous, "verified");
    expect(ambiguousEvidence.skill_governance.required_trust_level).toBe("verified");
    expect(ambiguousEvidence.skill_governance.denial_reason).toMatch(/multiple harnesses/i);

    insertSkill(db, { name: "deny-trust", dispatch_status: "disabled", completeness_pct: 100 });
    const denied = lookupSkillContract(db, "deny-trust");
    const deniedEvidence = buildSkillEvidence(denied, "signed");
    expect(deniedEvidence.skill_governance.denied_trust_level).toBeDefined();
    expect(deniedEvidence.skill_governance.required_trust_level).toBe("signed");
  });
});
