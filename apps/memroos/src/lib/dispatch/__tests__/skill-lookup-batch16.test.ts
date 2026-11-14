// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { lookupSkillContract } from "@/lib/dispatch/skill-lookup";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

function computeContentHash(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

function insertSkill(
  database: Database.Database,
  opts: {
    name: string;
    harness: string;
    body?: string;
    dispatchStatus?: string;
    completeness?: number;
    lifecycle?: string | null;
    trust?: string;
    signature?: string | null;
    version?: string;
  },
): { contentHash: string; version: string } {
  const body = opts.body ?? `body-${randomUUID()}`;
  const contentHash = computeContentHash(body);
  const version = opts.version ?? "1.0.0";
  database
    .prepare(
      `INSERT INTO skill_registry (
        name, description, owner, source_harness, risk_tier, dispatch_status,
        version, preconditions, allowed_tools, verification_checks, rollback_behavior,
        raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
        evidence_examples, content_hash, trust_level, signature, lifecycle_state
      ) VALUES (?, '', 'ops', ?, 'low', ?, ?, '', '', '', '', ?, ?, '[]', 'op', ?, '', ?, ?, ?, ?)`,
    )
    .run(
      opts.name,
      opts.harness,
      opts.dispatchStatus ?? "enabled",
      version,
      body,
      opts.completeness ?? 100,
      new Date().toISOString(),
      contentHash,
      opts.trust ?? "unsigned",
      opts.signature ?? null,
      opts.lifecycle ?? "enabled",
    );
  return { contentHash, version };
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("skill-lookup batch16 — pinned signature, tamper, and status labels", () => {
  it("denies pinned skills when requireSigned is true but signature is missing", () => {
    const database = freshDb();
    const name = `pin-unsigned-${randomUUID().slice(0, 8)}`;
    const { contentHash, version } = insertSkill(database, { name, harness: "claude", signature: null });
    const result = lookupSkillContract(database, name, {
      pinned: {
        agent_id: "agent-1",
        source_harness: "claude",
        current_version: version,
        current_content_hash: contentHash,
      },
      requireSigned: true,
    });
    expect(result?.kind).toBe("denied");
    expect(result && "reason" in result ? result.reason : "").toMatch(/unsigned/i);
  });

  it("denies pinned skills when raw_body no longer matches content_hash", () => {
    const database = freshDb();
    const name = `pin-tamper-${randomUUID().slice(0, 8)}`;
    const { contentHash, version } = insertSkill(database, { name, harness: "claude", signature: "sig" });
    database.prepare(`UPDATE skill_registry SET raw_body = ? WHERE name = ?`).run("tampered-body", name);
    const result = lookupSkillContract(database, name, {
      pinned: {
        agent_id: "agent-1",
        source_harness: "claude",
        current_version: version,
        current_content_hash: contentHash,
      },
    });
    expect(result?.kind).toBe("denied");
    expect(result && "reason" in result ? result.reason : "").toMatch(/integrity verification failed/i);
  });

  it("labels review, deprecated lifecycle, and incomplete contracts in denial reasons", () => {
    const database = freshDb();
    const reviewName = `review-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name: reviewName, harness: "claude", dispatchStatus: "review" });
    const review = lookupSkillContract(database, reviewName, { sourceHarness: "claude" });
    expect(review?.kind).toBe("denied");
    expect(review && "reason" in review ? review.reason : "").toMatch(/under review/i);

    const deprecatedName = `deprecated-${randomUUID().slice(0, 8)}`;
    insertSkill(database, {
      name: deprecatedName,
      harness: "claude",
      lifecycle: "deprecated",
    });
    const deprecated = lookupSkillContract(database, deprecatedName, { sourceHarness: "claude" });
    expect(deprecated && "reason" in deprecated ? deprecated.reason : "").toMatch(/deprecated/i);

    const incompleteName = `incomplete-${randomUUID().slice(0, 8)}`;
    insertSkill(database, {
      name: incompleteName,
      harness: "claude",
      completeness: 50,
    });
    const incomplete = lookupSkillContract(database, incompleteName, { sourceHarness: "claude" });
    expect(incomplete && "reason" in incomplete ? incomplete.reason : "").toMatch(/incomplete/i);
  });
});
