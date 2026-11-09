// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { computeContentHash } from "@/lib/skills/registry";
import { lookupSkillContract, parseTrustLevel } from "../skill-lookup";

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
    trust?: string;
    lifecycle?: string | null;
    version?: string;
    hash?: string;
    body?: string;
  },
): { hash: string; body: string } {
  const body = opts.body ?? `body-${randomUUID()}`;
  const contentHash = opts.hash ?? createHash("sha256").update(body, "utf8").digest("hex");
  database
    .prepare(
      `INSERT INTO skill_registry (
        name, description, owner, source_harness, risk_tier, dispatch_status,
        version, preconditions, allowed_tools, verification_checks, rollback_behavior,
        raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
        evidence_examples, content_hash, trust_level, lifecycle_state, signature
      ) VALUES (?, '', 'ops', ?, 'low', 'enabled', ?, '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, ?, ?, 'sig-28c')`,
    )
    .run(
      opts.name,
      opts.harness,
      opts.version ?? "1.0.0",
      body,
      new Date().toISOString(),
      contentHash,
      opts.trust ?? "signed",
      opts.lifecycle ?? "enabled",
    );
  return { hash: contentHash, body };
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("skill-lookup batch28c — pinned drift, lifecycle, trust parser", () => {
  it("parseTrustLevel rejects unknown labels", () => {
    expect(parseTrustLevel("verified")).toBe("verified");
    expect(parseTrustLevel("  UNKNOWN  ")).toBeNull();
    expect(parseTrustLevel(null)).toBeNull();
  });

  it("denies pinned skills when registry hash drifted from pin", () => {
    const database = freshDb();
    const name = `pin-hash-b28c-${randomUUID().slice(0, 6)}`;
    const { hash, body } = insertSkill(database, { name, harness: "claude", version: "2.0.0" });
    const staleHash = createHash("sha256").update(`${body}-stale`, "utf8").digest("hex");
    const result = lookupSkillContract(database, name, {
      pinned: {
        agent_id: "agent-28c",
        source_harness: "claude",
        current_version: "2.0.0",
        current_content_hash: staleHash,
      },
    });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") return;
    expect(result.reason).toMatch(/Pinned hash mismatch/i);
    expect(hash).not.toBe(staleHash);
  });

  it("denies enabled rows with deprecated lifecycle_state", () => {
    const database = freshDb();
    const name = `life-b28c-${randomUUID().slice(0, 6)}`;
    insertSkill(database, { name, harness: "codex", lifecycle: "deprecated" });
    const result = lookupSkillContract(database, name, { sourceHarness: "codex" });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") return;
    expect(result.reason).toMatch(/deprecated/i);
  });

  it("returns null for blank skill names without hitting SQL", () => {
    const database = freshDb();
    expect(lookupSkillContract(database, "   ")).toBeNull();
  });
});
