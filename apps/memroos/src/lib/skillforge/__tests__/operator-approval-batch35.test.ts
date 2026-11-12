// @vitest-environment node
import crypto from "crypto";
import { createHash } from "crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  applyApprovalAction,
  listProposals,
  markApplied,
  rollbackProposal,
} from "../operator-approval";

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
    CREATE TABLE seal_audit_log (
      proposal_id TEXT NOT NULL, event TEXT NOT NULL, detail TEXT, timestamp TEXT NOT NULL
    );
    CREATE TABLE audit_entries (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, actor_id TEXT NOT NULL, actor_role TEXT NOT NULL,
      event_type TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      reason TEXT, metadata_json TEXT, created_at TEXT NOT NULL
    );
  `);
  return db;
}

describe("operator-approval batch35", () => {
  it("applyApprovalAction returns error when proposal id is missing (lookup guard)", () => {
    const db = operatorDb();
    const result = applyApprovalAction(db, {
      proposalId: `missing-prop-b35-${crypto.randomUUID().slice(0, 6)}`,
      action: "approve",
      operator: "operator-b35",
    });
    expect(result.success).toBe(false);
  });

  it("applyApprovalAction rollback without export is honest restored=false (237–239)", () => {
    const db = operatorDb();
    const proposalId = `prop-no-export-b35-${crypto.randomUUID().slice(0, 6)}`;
    db.prepare(
      `INSERT INTO skillforge_proposals
         (id, source_skill_id, source_version, proposed_diff, status, created_at, updated_at)
       VALUES (?, '1', '1.0.0', '{}', 'exported', datetime('now'), datetime('now'))`,
    ).run(proposalId);
    const rolled = applyApprovalAction(db, {
      proposalId,
      action: "rollback",
      operator: "operator-b35",
      reasoning: "no export row",
    });
    expect(rolled.success).toBe(true);
    expect(rolled.restored).toBe(false);
  });

  it("listProposals buckets approved and rejected rows (queue branches)", () => {
    const db = operatorDb();
    const approvedId = `approved-b35-${crypto.randomUUID().slice(0, 6)}`;
    const rejectedId = `rejected-b35-${crypto.randomUUID().slice(0, 6)}`;
    db.prepare(
      `INSERT INTO skillforge_proposals (id, source_skill_id, source_version, proposed_diff, status, created_at, updated_at)
       VALUES (?, '1', '1.0.0', '{}', 'approved', datetime('now'), datetime('now'))`,
    ).run(approvedId);
    db.prepare(
      `INSERT INTO skillforge_proposals (id, source_skill_id, source_version, proposed_diff, status, created_at, updated_at)
       VALUES (?, '1', '1.0.0', '{}', 'rejected', datetime('now'), datetime('now'))`,
    ).run(rejectedId);
    const queue = listProposals(db);
    expect(queue.approved.some((p) => p.id === approvedId)).toBe(true);
    expect(queue.rejected.some((p) => p.id === rejectedId)).toBe(true);
  });

  it("markApplied rejects missing proposal (guard branch)", () => {
    const db = operatorDb();
    const result = markApplied(db, `missing-b35-${crypto.randomUUID().slice(0, 6)}`);
    expect(result.success).toBe(false);
  });

  it("rollbackProposal refuses proposal in pending state (341–343)", () => {
    const db = operatorDb();
    const proposalId = `pending-rb-b35-${crypto.randomUUID().slice(0, 6)}`;
    db.prepare(
      `INSERT INTO skillforge_proposals
         (id, source_skill_id, source_version, proposed_diff, status, created_at, updated_at)
       VALUES (?, '1', '1.0.0', '{}', 'pending', datetime('now'), datetime('now'))`,
    ).run(proposalId);
    const rolled = rollbackProposal(db, proposalId, "operator-b35");
    expect(rolled.success).toBe(false);
    expect(rolled.error).toMatch(/Cannot rollback/);
  });

  it("rollbackProposal restores numeric skill id with computed hash (365–368)", () => {
    const db = operatorDb();
    const proposalId = `prop-hash-b35-${crypto.randomUUID().slice(0, 6)}`;
    const raw = "rollback-hash-body-b35";
    const hash = createHash("sha256").update(raw).digest("hex");
    db.prepare(`INSERT INTO skill_registry (id, version, content_hash, raw_body) VALUES (1, '1.0.0', ?, ?)`).run(
      hash,
      raw,
    );
    db.prepare(
      `INSERT INTO skillforge_proposals
         (id, source_skill_id, source_version, proposed_diff, status, created_at, updated_at)
       VALUES (?, '1', '1.0.0', '{}', 'applied', datetime('now'), datetime('now'))`,
    ).run(proposalId);
    db.prepare(
      `INSERT INTO skillforge_exports (proposal_id, pre_version, pre_hash, pre_raw_body, created_at)
       VALUES (?, '0.6.0', NULL, ?, datetime('now'))`,
    ).run(proposalId, raw);
    const rolled = rollbackProposal(db, proposalId, "operator-b35");
    expect(rolled.success).toBe(true);
    expect(rolled.postHash).toBe(hash);
  });
});
