// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { computeContentHash } from "@/lib/skills/registry";

const TEST_DB_DIR = path.join(os.tmpdir(), `skill-lookup-b14-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "lookup.db");

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
  const rawBody = overrides.raw_body ?? "## body";
  const row = {
    name: overrides.name ?? "pinned-skill",
    source_harness: overrides.source_harness ?? "claude",
    risk_tier: "low",
    dispatch_status: overrides.dispatch_status ?? "enabled",
    completeness_pct: overrides.completeness_pct ?? 100,
    lifecycle_state: overrides.lifecycle_state ?? "enabled",
    owner: "team",
    description: "desc",
    version: overrides.version ?? "2.0.0",
    raw_body: rawBody,
    missing_fields_json: "[]",
    preconditions: "p",
    allowed_tools: "t",
    verification_checks: "v",
    rollback_behavior: "r",
    imported_by: "operator",
    imported_at: new Date().toISOString(),
    evidence_examples: "e",
    signature: overrides.signature ?? "sig",
    trust_level: overrides.trust_level ?? "signed",
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

describe("skill-lookup batch14 — pinned dispatch and legacy signatures", () => {
  it("denies pinned skills for incomplete, disabled, lifecycle, trust, signature, and tamper cases", async () => {
    const { lookupSkillContract } = await import("../skill-lookup");
    const pin = {
      agent_id: "agent-1",
      source_harness: "claude",
      current_version: "2.0.0",
      current_content_hash: computeContentHash("## body"),
    };

    insertSkill(db, { name: "pin-incomplete", completeness_pct: 80 });
    let result = lookupSkillContract(db, "pin-incomplete", { pinned: pin });
    expect(result?.kind).toBe("denied");
    expect(result && "reason" in result ? result.reason : "").toMatch(/incomplete/i);

    insertSkill(db, { name: "pin-disabled", dispatch_status: "disabled" });
    result = lookupSkillContract(db, "pin-disabled", { pinned: pin });
    expect(result?.kind).toBe("denied");
    expect(result && "reason" in result ? result.reason : "").toMatch(/dispatch_status/i);

    insertSkill(db, { name: "pin-lifecycle", lifecycle_state: "deprecated" });
    result = lookupSkillContract(db, "pin-lifecycle", { pinned: pin });
    expect(result?.kind).toBe("denied");
    expect(result && "reason" in result ? result.reason : "").toMatch(/lifecycle_state/i);

    insertSkill(db, { name: "pin-trust", trust_level: "unsigned" });
    result = lookupSkillContract(db, "pin-trust", { pinned: pin, minTrustLevel: "signed" });
    expect(result?.kind).toBe("denied");
    expect(result && "reason" in result ? result.reason : "").toMatch(/trust level/i);

    insertSkill(db, {
      name: "pin-tamper",
      content_hash: "a".repeat(64),
    });
    result = lookupSkillContract(db, "pin-tamper", { pinned: pin });
    expect(result?.kind).toBe("denied");
    expect(result && "reason" in result ? result.reason : "").toMatch(/hash mismatch/i);
  });

  it("returns pinned hit when all governance gates pass", async () => {
    const { lookupSkillContract } = await import("../skill-lookup");
    insertSkill(db, { name: "pin-ok" });
    const result = lookupSkillContract(db, "pin-ok", {
      pinned: {
        agent_id: "agent-1",
        source_harness: "claude",
        current_version: "2.0.0",
        current_content_hash: computeContentHash("## body"),
      },
    });
    expect(result?.kind).toBe("hit");
  });

  it("supports legacy (db, name, minTrustLevel, options) signature", async () => {
    const { lookupSkillContract } = await import("../skill-lookup");
    insertSkill(db, { name: "legacy-trust", trust_level: "unsigned", signature: null });
    const denied = lookupSkillContract(db, "legacy-trust", "signed", { sourceHarness: "claude" });
    expect(denied?.kind).toBe("denied");
  });

  it("denies explicit version mismatches on enabled rows", async () => {
    const { lookupSkillContract } = await import("../skill-lookup");
    insertSkill(db, { name: "versioned-skill", version: "3.1.0" });
    const result = lookupSkillContract(db, "versioned-skill", {
      sourceHarness: "claude",
      version: "1.0.0",
    });
    expect(result?.kind).toBe("denied");
    expect(result && "reason" in result ? result.reason : "").toMatch(/version mismatch/i);
  });
});
