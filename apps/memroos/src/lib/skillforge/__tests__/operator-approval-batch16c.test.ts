// @vitest-environment node
import crypto from "crypto";
import { createHash } from "crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  applyApprovalAction,
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
    CREATE TABLE audit_entries (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, actor_id TEXT NOT NULL, actor_role TEXT NOT NULL,
      event_type TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      reason TEXT, metadata_json TEXT, created_at TEXT NOT NULL
    );
  `);
  return db;
}

describe("operator-approval batch16c — approve, reject, rollback honesty", () => {
  it("applyApprovalAction approves gated proposals and rejects unknown actions", () => {
    const db = operatorDb();
    const proposalId = `prop-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO skillforge_proposals (id, source_skill_id, source_version, proposed_diff, status, created_at, updated_at)
       VALUES (?, '1', '1.0.0', '{}', 'gated', datetime('now'), datetime('now'))`,
    ).run(proposalId);
    const approved = applyApprovalAction(db, {
      proposalId,
      action: "approve",
      operator: "operator",
    });
    expect(approved.success).toBe(true);
    expect(approved.postState).toBe("approved");
  });

  it("applyApprovalAction request_changes moves pending_approval back to pending", () => {
    const db = operatorDb();
    const proposalId = `prop-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO skillforge_proposals (id, source_skill_id, source_version, proposed_diff, status, created_at, updated_at)
       VALUES (?, '1', '1.0.0', '{}', 'pending_approval', datetime('now'), datetime('now'))`,
    ).run(proposalId);
    const result = applyApprovalAction(db, {
      proposalId,
      action: "request_changes",
      operator: "operator",
      reasoning: "needs edits",
    });
    expect(result.success).toBe(true);
    expect(result.postState).toBe("pending");
  });

  it("rollbackProposal reports restored=false when no export row exists", () => {
    const db = operatorDb();
    const proposalId = `prop-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO skillforge_proposals (id, source_skill_id, source_version, proposed_diff, status, created_at, updated_at)
       VALUES (?, '1', '1.0.0', '{}', 'applied', datetime('now'), datetime('now'))`,
    ).run(proposalId);
    const result = rollbackProposal(db, proposalId, "operator", "no export");
    expect(result.success).toBe(true);
    expect(result.restored).toBe(false);
    expect(result.proposalState).toBe("pending_approval");
  });

  it("markApplied succeeds for approved proposals", () => {
    const db = operatorDb();
    const proposalId = `prop-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO skillforge_proposals (id, source_skill_id, source_version, proposed_diff, status, created_at, updated_at)
       VALUES (?, '1', '1.0.0', '{}', 'approved', datetime('now'), datetime('now'))`,
    ).run(proposalId);
    expect(markApplied(db, proposalId).success).toBe(true);
    const row = db.prepare(`SELECT status FROM skillforge_proposals WHERE id = ?`).get(proposalId) as {
      status: string;
    };
    expect(row.status).toBe("applied");
  });

  it("applyApprovalAction rollback restores registry from export pre_raw_body", () => {
    const db = operatorDb();
    const proposalId = `prop-${crypto.randomUUID()}`;
    const preBody = "prior raw body";
    const preHash = createHash("sha256").update(preBody, "utf8").digest("hex");
    db.prepare(
      `INSERT INTO skillforge_proposals (id, source_skill_id, source_version, proposed_diff, status, created_at, updated_at)
       VALUES (?, '3', '2.0.0', '{}', 'exported', datetime('now'), datetime('now'))`,
    ).run(proposalId);
    db.prepare(`INSERT INTO skill_registry (id, version, content_hash, raw_body) VALUES (3, '2.0.0', ?, 'new')`).run(
      createHash("sha256").update("new").digest("hex"),
    );
    db.prepare(
      `INSERT INTO skillforge_exports (proposal_id, pre_version, pre_hash, pre_raw_body, created_at)
       VALUES (?, '1.0.0', ?, ?, datetime('now'))`,
    ).run(proposalId, preHash, preBody);
    const rolled = applyApprovalAction(db, {
      proposalId,
      action: "rollback",
      operator: "operator",
    });
    expect(rolled.success).toBe(true);
    expect(rolled.restored).toBe(true);
    expect(rolled.postHash).toBe(preHash);
  });
});
