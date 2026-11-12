// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { computeContentHash } from "@/lib/skills/registry";
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
    dispatchStatus: string;
    completeness?: number;
    lifecycle?: string;
    version?: string;
    body?: string;
    signature?: string | null;
    trust?: string;
  },
): { body: string; hash: string } {
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
      opts.harness,
      opts.dispatchStatus,
      opts.version ?? "1.0.0",
      body,
      opts.completeness ?? 100,
      new Date().toISOString(),
      contentHash,
      opts.trust ?? "signed",
      opts.lifecycle ?? "enabled",
      opts.signature === undefined ? "sig-b34" : opts.signature,
    );
  return { body, hash: contentHash };
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("skill-lookup batch34 — pinned drift, version mismatch, review label", () => {
  it("denies pinned skills on version and hash mismatch (282-300)", () => {
    const database = freshDb();
    const name = `pin-drift-b34-${randomUUID().slice(0, 8)}`;
    const { hash } = insertSkill(database, { name, harness: "claude", dispatchStatus: "enabled", version: "2.0.0" });
    let result = lookupSkillContract(database, name, {
      sourceHarness: "claude",
      pinned: {
        agent_id: "agent-b34",
        source_harness: "claude",
        current_version: "1.0.0",
        current_content_hash: hash,
      },
    });
    expect(result?.kind).toBe("denied");
    expect(result?.reason).toMatch(/version mismatch/i);

    result = lookupSkillContract(database, name, {
      sourceHarness: "claude",
      pinned: {
        agent_id: "agent-b34",
        source_harness: "claude",
        current_version: "2.0.0",
        current_content_hash: "deadbeef",
      },
    });
    expect(result?.kind).toBe("denied");
    expect(result?.reason).toMatch(/hash mismatch/i);
  });

  it("denies enabled hits on version mismatch and low trust (480-512)", () => {
    const database = freshDb();
    const name = `ver-b34-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name, harness: "codex", dispatchStatus: "enabled", version: "3.0.0", trust: "unsigned" });
  const mismatch = lookupSkillContract(database, name, { sourceHarness: "codex", version: "9.9.9" });
    expect(mismatch?.kind).toBe("denied");
    expect(mismatch?.reason).toMatch(/version mismatch/i);

    const lowTrust = lookupSkillContract(database, name, { sourceHarness: "codex", minTrustLevel: "verified" });
    expect(lowTrust?.kind).toBe("denied");
    expect(lowTrust?.reason).toMatch(/trust level/i);
  });

  it("labels review dispatch_status on incomplete-enabled contracts (611-625)", () => {
    const database = freshDb();
    const name = `review-b34-${randomUUID().slice(0, 8)}`;
    insertSkill(database, {
      name,
      harness: "codex",
      dispatchStatus: "review",
      lifecycle: "enabled",
    });
    const result = lookupSkillContract(database, name, { sourceHarness: "codex" });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") return;
    expect(result.reason).toMatch(/under review/);
  });

  it("pinned hit returns summary when governance gates pass (369-381)", () => {
    const database = freshDb();
    const name = `pin-hit-b34-${randomUUID().slice(0, 8)}`;
    const body = "## pinned hit b34";
    const hash = computeContentHash(body);
    insertSkill(database, {
      name,
      harness: "claude",
      dispatchStatus: "enabled",
      version: "4.0.0",
      body,
    });
    const result = lookupSkillContract(database, name, {
      sourceHarness: "claude",
      pinned: {
        agent_id: "agent-b34",
        source_harness: "claude",
        current_version: "4.0.0",
        current_content_hash: hash,
      },
    });
    expect(result?.kind).toBe("hit");
    if (result?.kind !== "hit") return;
    expect(result.skill.name).toBe(name);
    expect(result.skill.dispatch_status).toBe("enabled");
  });
});
