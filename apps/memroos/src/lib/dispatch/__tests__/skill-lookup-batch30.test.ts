// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

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
    harness: string;
    dispatchStatus: string;
    completeness?: number;
    lifecycle?: string | null;
    signature?: string | null;
  },
): void {
  const body = `body-${randomUUID()}`;
  const contentHash = createHash("sha256").update(body, "utf8").digest("hex");
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
      opts.harness,
      opts.dispatchStatus,
      body,
      opts.completeness ?? 100,
      new Date().toISOString(),
      contentHash,
      opts.lifecycle ?? "enabled",
      opts.signature === undefined ? "sig-b30" : opts.signature,
    );
}

afterEach(() => {
  db?.close();
  db = null;
  vi.restoreAllMocks();
});

describe("skill-lookup batch30 — any-row SQL rethrow and unknown dispatch label", () => {
  it("rethrows non-column SQL errors during any-contract fallback (line 552)", () => {
    const database = freshDb();
    const name = `sql-rethrow-b30-${randomUUID().slice(0, 8)}`;
    insertSkill(database, { name, harness: "claude", dispatchStatus: "disabled" });
    const original = database.prepare.bind(database);
    vi.spyOn(database, "prepare").mockImplementation((sql: string, ...rest) => {
      const stmt = original(sql, ...rest);
      if (typeof sql === "string" && sql.includes("FROM skill_registry") && !sql.includes("dispatch_status = 'enabled'")) {
        return {
          ...stmt,
          get: () => {
            throw new Error("database disk image is malformed batch30");
          },
        } as ReturnType<typeof database.prepare>;
      }
      return stmt;
    });
    expect(() => lookupSkillContract(database, name, { sourceHarness: "claude" })).toThrow(/malformed batch30/);
  });

  it("uses dispatch_status fallback label when enabled+complete but lifecycle blocks hit (line 625)", () => {
    const database = freshDb();
    const name = `retired-b30-${randomUUID().slice(0, 8)}`;
    insertSkill(database, {
      name,
      harness: "codex",
      dispatchStatus: "enabled",
      lifecycle: "retired",
    });
    const result = lookupSkillContract(database, name, { sourceHarness: "codex" });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") return;
    expect(result.reason).toMatch(/retired/);
  });

  it("labels enabled dispatch_status when require_signed excludes enabled hit (line 625 else branch)", () => {
    const database = freshDb();
    const name = `unsigned-enabled-b30-${randomUUID().slice(0, 8)}`;
    insertSkill(database, {
      name,
      harness: "codex",
      dispatchStatus: "enabled",
      signature: null,
    });
    const result = lookupSkillContract(database, name, {
      sourceHarness: "codex",
      requireSigned: true,
    });
    expect(result?.kind).toBe("denied");
    if (result?.kind !== "denied") return;
    expect(result.reason).toMatch(/unsigned|enabled/);
  });
});
