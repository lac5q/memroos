// @vitest-environment node
import crypto from "crypto";
import { createHash } from "crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { applyApprovalAction, markApplied } from "../operator-approval";

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
    CREATE TABLE skill_registry (
      id INTEGER PRIMARY KEY, version TEXT, content_hash TEXT, raw_body TEXT, imported_at TEXT
    );
    CREATE TABLE audit_entries (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, actor_id TEXT NOT NULL, actor_role TEXT NOT NULL,
      event_type TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      reason TEXT, metadata_json TEXT, created_at TEXT NOT NULL
    );
  `);
  return db;
}

describe("operator-approval batch17 — rollback metadata and markApplied guards", () => {
  it("rollback with export but non-numeric source_skill_id still records pre/post versions", () => {
    const db = operatorDb();
    const proposalId = `prop-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO skillforge_proposals (id, source_skill_id, source_version, proposed_diff, status, created_at, updated_at)
       VALUES (?, 'not-numeric', '1.0.0', '{}', 'exported', datetime('now'), datetime('now'))`,
    ).run(proposalId);
    db.prepare(
      `INSERT INTO skillforge_exports (proposal_id, pre_version, pre_hash, pre_raw_body, created_at)
       VALUES (?, '0.9.0', ?, NULL, datetime('now'))`,
    ).run(proposalId, createHash("sha256").update("prior").digest("hex"));
    const rolled = applyApprovalAction(db, {
      proposalId,
      action: "rollback",
      operator: "operator",
    });
    expect(rolled.success).toBe(true);
    expect(rolled.restored).toBe(true);
    expect(rolled.postVersion).toBe("0.9.0");
  });

  it("markApplied returns not found for missing proposals", () => {
    const db = operatorDb();
    const result = markApplied(db, `missing-${crypto.randomUUID()}`);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Proposal not found");
  });

  it("applyApprovalAction returns structured error when audit insert fails during rollback", () => {
    const db = operatorDb();
    const proposalId = `prop-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO skillforge_proposals (id, source_skill_id, source_version, proposed_diff, status, created_at, updated_at)
       VALUES (?, '1', '1.0.0', '{}', 'applied', datetime('now'), datetime('now'))`,
    ).run(proposalId);
    db.exec("DROP TABLE audit_entries");
    const result = applyApprovalAction(db, {
      proposalId,
      action: "rollback",
      operator: "operator",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
