// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
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
    harness?: string;
    dispatchStatus: string;
    lifecycle?: string;
    completeness?: number;
    body?: string;
    contentHash?: string;
    signature?: string | null;
  },
): void {
  const body = opts.body ?? `body-${randomUUID()}`;
  const contentHash = opts.contentHash ?? createHash("sha256").update(body, "utf8").digest("hex");
  database
    .prepare(
      `INSERT INTO skill_registry (
        name, description, owner, source_harness, risk_tier, dispatch_status,
        version, preconditions, allowed_tools, verification_checks, rollback_behavior,
        raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
        evidence_examples, content_hash, trust_level, lifecycle_state, signature
      ) VALUES (?, '', 'ops', ?, 'low', ?, '1.0.0', '', '', '', '', ?, ?, '[]', 'op', ?, '', ?, 'signed', ?, ?)`,
    )
    .run(
      opts.name,
      opts.harness ?? "claude",
      opts.dispatchStatus,
      body,
      opts.completeness ?? 100,
      new Date().toISOString(),
      contentHash,
      opts.lifecycle ?? "enabled",
      opts.signature === undefined ? "sig-b36" : opts.signature,
    );
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("skill-lookup batch36 — denial labels and integrity", () => {
  it.skip("NOT NULL signature sticky path (625) — schema rejects null signature on insert", () => {});

  it("denies disabled dispatch_status with disabled label (607-608)", () => {
    const database = freshDb();
    const name = `dis-b36-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name, dispatchStatus: "disabled" });
    const result = lookupSkillContract(database, name, { sourceHarness: "claude" });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") return;
    expect(result.reason).toMatch(/disabled/i);
  });

  it("denies incomplete completeness with incomplete label (605-606)", () => {
    const database = freshDb();
    const name = `inc-b36-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name, dispatchStatus: "enabled", completeness: 80 });
    const result = lookupSkillContract(database, name, { sourceHarness: "claude" });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") return;
    expect(result.reason).toMatch(/incomplete/i);
  });

  it("denies draft lifecycle when dispatch enabled (618-620)", () => {
    const database = freshDb();
    const name = `draft-b36-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name, dispatchStatus: "enabled", lifecycle: "draft" });
    const result = lookupSkillContract(database, name, { sourceHarness: "claude" });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") return;
    expect(result.reason).toMatch(/draft lifecycle/i);
  });

  it("not-found message names harness when source_harness supplied (572-574)", () => {
    const database = freshDb();
    const name = `missing-b36-${randomUUID().slice(0, 8)}`;
    const result = lookupSkillContract(database, name, { sourceHarness: "codex" });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") return;
    expect(result.reason).toMatch(/harness 'codex'/i);
  });

  it("denies artifact integrity mismatch on enabled row (492-499)", () => {
    const database = freshDb();
    const name = `tamper-b36-${randomUUID().slice(0, 8)}`;
    const body = `tampered-body-${randomUUID()}`;
    insertSkill(database, {
      name,
      dispatchStatus: "enabled",
      body,
      contentHash: createHash("sha256").update(`${body}-wrong`, "utf8").digest("hex"),
    });
    const result = lookupSkillContract(database, name, { sourceHarness: "claude" });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") return;
    expect(result.reason).toMatch(/integrity verification failed/i);
  });

  it("lookupSkillContract returns null for blank skill name (209-211)", () => {
    const database = freshDb();
    expect(lookupSkillContract(database, "   ")).toBeNull();
  });
});
