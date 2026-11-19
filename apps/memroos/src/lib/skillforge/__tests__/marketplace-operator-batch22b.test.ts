// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { publishSkill } from "../marketplace";
import { markApplied, rollbackProposal } from "../operator-approval";

function insertRegistryRow(db: Database.Database, name: string): number {
  const body = `---\nname: ${name}\n---\n# ${name}`;
  const hash = createHash("sha256").update(body).digest("hex");
  return Number(
    db
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
            version, preconditions, allowed_tools, verification_checks, rollback_behavior,
            raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
            evidence_examples, content_hash, trust_level, lifecycle_state, signature)
         VALUES (?, '', 'ops', 'memroos', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'batch22b', ?, '', ?, 'signed', 'enabled', ?)`,
      )
      .run(name, body, new Date().toISOString(), hash, "sig-b22b")
      .lastInsertRowid,
  );
}

describe("skillforge marketplace + operator-approval batch22b", () => {
  it("publishSkill rejects blank skillId before registry lookup", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const result = publishSkill(db, {
      skillId: "   ",
      name: "x",
      description: "d",
      author: "a",
      tags: [],
      category: "general",
      changelog: "c",
    });
    expect(result.success).toBe(false);
    expect(result.code).toBe("missing_skill_id");
    db.close();
  });

  it("publishSkill returns governance errors from registry-bound publish", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const result = publishSkill(db, {
      skillId: "999999",
      name: "missing",
      description: "d",
      author: "a",
      tags: [],
      category: "general",
      changelog: "c",
    });
    expect(result.success).toBe(false);
    expect(result.code).toBe("skill_not_found");
    db.close();
  });

  it("publishSkill succeeds and pins registry version on listing", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertRegistryRow(db, `market-b22b-${randomUUID().slice(0, 6)}`);
    const result = publishSkill(db, {
      skillId: String(skillId),
      name: "listed",
      description: "d",
      author: "a",
      tags: ["ops"],
      category: "general",
      changelog: "initial",
      sourceHarness: "memroos",
    });
    expect(result.success).toBe(true);
    db.close();
  });

  function operatorDb(): Database.Database {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE skillforge_proposals (
        id TEXT PRIMARY KEY, seal_proposal_id TEXT, source_skill_id TEXT NOT NULL,
        source_version TEXT NOT NULL, proposed_diff TEXT NOT NULL, status TEXT NOT NULL,
        train_split_id TEXT, validation_results TEXT, held_out_results TEXT, w_delta REAL,
        rejected_edits TEXT NOT NULL DEFAULT '[]', residual_risks TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE skillforge_exports (
        id INTEGER PRIMARY KEY, proposal_id TEXT NOT NULL, pre_version TEXT, pre_hash TEXT,
        pre_raw_body TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE audit_entries (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, actor_id TEXT NOT NULL, actor_role TEXT NOT NULL,
        event_type TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
        reason TEXT, metadata_json TEXT, created_at TEXT NOT NULL
      );
    `);
    return db;
  }

  it("rollbackProposal returns structured error when transaction fails", () => {
    const db = operatorDb();
    const proposalId = `prop-${randomUUID()}`;
    db.prepare(
      `INSERT INTO skillforge_proposals (id, source_skill_id, source_version, proposed_diff, status, created_at, updated_at)
       VALUES (?, 'not-a-registry-id', '1.0.0', '{}', 'approved', datetime('now'), datetime('now'))`,
    ).run(proposalId);
    vi.spyOn(db, "transaction").mockImplementation(() => {
      throw new Error("tx exploded");
    });
    const result = rollbackProposal(db, proposalId);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/tx exploded/);
    db.close();
  });

  it("markApplied returns structured error when update fails", () => {
    const db = operatorDb();
    const proposalId = `prop-${randomUUID()}`;
    db.prepare(
      `INSERT INTO skillforge_proposals (id, source_skill_id, source_version, proposed_diff, status, created_at, updated_at)
       VALUES (?, '1', '1.0.0', '{}', 'approved', datetime('now'), datetime('now'))`,
    ).run(proposalId);
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql: unknown) => {
      const stmt = originalPrepare(sql as string);
      if (typeof sql === "string" && sql.includes("UPDATE skillforge_proposals")) {
        return {
          run: () => {
            throw new Error("update failed");
          },
          get: stmt.get.bind(stmt),
          all: stmt.all.bind(stmt),
        } as ReturnType<typeof db.prepare>;
      }
      return stmt;
    });
    const result = markApplied(db, proposalId);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/update failed/);
    db.close();
  });
});
