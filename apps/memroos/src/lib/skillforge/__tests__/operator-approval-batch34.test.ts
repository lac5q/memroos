// @vitest-environment node
import crypto from "crypto";
import { createHash } from "crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { applyApprovalAction, listProposals, markApplied, rollbackProposal } from "../operator-approval";

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

describe("operator-approval batch34 — gated approve, request_changes, rollback branches", () => {
  it("approves proposals in gated status and writes seal audit on reject (234, 262, 287–291)", () => {
    const db = operatorDb();
    const proposalId = `prop-gated-b34-${crypto.randomUUID().slice(0, 6)}`;
    const sealId = `seal-b34-${crypto.randomUUID().slice(0, 6)}`;
    db.prepare(
      `INSERT INTO skillforge_proposals
         (id, seal_proposal_id, source_skill_id, source_version, proposed_diff, status, created_at, updated_at)
       VALUES (?, ?, '1', '1.0.0', '{}', 'gated', datetime('now'), datetime('now'))`,
    ).run(proposalId, sealId);
    const approved = applyApprovalAction(db, {
      proposalId,
      action: "approve",
      operator: "operator-b34",
    });
    expect(approved.success).toBe(true);
    expect(approved.postState).toBe("approved");

    db.prepare(
      `UPDATE skillforge_proposals SET status = 'pending_approval', seal_proposal_id = ? WHERE id = ?`,
    ).run(sealId, proposalId);
    const rejected = applyApprovalAction(db, {
      proposalId,
      action: "reject",
      operator: "operator-b34",
      reasoning: "needs work",
    });
    expect(rejected.success).toBe(true);
    expect(rejected.postState).toBe("rejected");
    // Approve + reject can share the same second-resolution timestamp; assert both
    // seal events exist rather than relying on ORDER BY timestamp alone.
    const sealEvents = db
      .prepare(`SELECT event FROM seal_audit_log WHERE proposal_id = ?`)
      .all(sealId) as Array<{ event: string }>;
    expect(sealEvents.map((row) => row.event).sort()).toEqual(["approved", "rejected"]);
  });

  it("request_changes moves proposal back to pending", () => {
    const db = operatorDb();
    const proposalId = `prop-changes-b34-${crypto.randomUUID().slice(0, 6)}`;
    db.prepare(
      `INSERT INTO skillforge_proposals
         (id, source_skill_id, source_version, proposed_diff, status, created_at, updated_at)
       VALUES (?, '1', '1.0.0', '{}', 'pending_approval', datetime('now'), datetime('now'))`,
    ).run(proposalId);
    const result = applyApprovalAction(db, {
      proposalId,
      action: "request_changes",
      operator: "operator-b34",
    });
    expect(result.success).toBe(true);
    expect(result.postState).toBe("pending");
  });

  it("rollback via applyApprovalAction restores export without numeric skill id (232–235, 365–368)", () => {
    const db = operatorDb();
    const proposalId = `prop-roll-b34-${crypto.randomUUID().slice(0, 6)}`;
    db.prepare(
      `INSERT INTO skillforge_proposals
         (id, source_skill_id, source_version, proposed_diff, status, created_at, updated_at)
       VALUES (?, 'not-numeric', '1.0.0', '{}', 'exported', datetime('now'), datetime('now'))`,
    ).run(proposalId);
    db.prepare(
      `INSERT INTO skillforge_exports (proposal_id, pre_version, pre_hash, pre_raw_body, created_at)
       VALUES (?, '0.8.0', ?, 'prior body', datetime('now'))`,
    ).run(proposalId, createHash("sha256").update("prior body").digest("hex"));

    const rolled = applyApprovalAction(db, {
      proposalId,
      action: "rollback",
      operator: "operator-b34",
      reasoning: "restore",
    });
    expect(rolled.success).toBe(true);
    expect(rolled.restored).toBe(true);
    expect(rolled.postVersion).toBe("0.8.0");
  });

  it("listProposals buckets statuses and markApplied guards wrong state (310, 417, 434–435)", () => {
    const db = operatorDb();
    const pendingId = `pending-b34-${crypto.randomUUID().slice(0, 6)}`;
    const pendingApprovalId = `pending-approval-b34-${crypto.randomUUID().slice(0, 6)}`;
    db.prepare(
      `INSERT INTO skillforge_proposals (id, source_skill_id, source_version, proposed_diff, status, created_at, updated_at)
       VALUES (?, '1', '1.0.0', '{}', 'gated', datetime('now'), datetime('now'))`,
    ).run(pendingId);
    db.prepare(
      `INSERT INTO skillforge_proposals (id, source_skill_id, source_version, proposed_diff, status, created_at, updated_at)
       VALUES (?, '1', '1.0.0', '{}', 'pending_approval', datetime('now'), datetime('now'))`,
    ).run(pendingApprovalId);

    const queue = listProposals(db);
    expect(queue.gated.some((p) => p.id === pendingId)).toBe(true);
    expect(queue.pending.some((p) => p.id === pendingApprovalId)).toBe(false);

    const badMark = markApplied(db, pendingApprovalId);
    expect(badMark.success).toBe(false);
    expect(badMark.error).toMatch(/must be approved/i);

    db.prepare(`UPDATE skillforge_proposals SET status = 'approved' WHERE id = ?`).run(pendingApprovalId);
    const okMark = markApplied(db, pendingApprovalId);
    expect(okMark.success).toBe(true);
  });

  it("rollbackProposal computes hash when export pre_hash is null (366–368, 402, 447)", () => {
    const db = operatorDb();
    const proposalId = `prop-rb-b34-${crypto.randomUUID().slice(0, 6)}`;
    const raw = "rollback-body-b34";
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
       VALUES (?, '0.7.0', NULL, ?, datetime('now'))`,
    ).run(proposalId, raw);

    const rolled = rollbackProposal(db, proposalId, "operator-b34", "hash fallback");
    expect(rolled.success).toBe(true);
    expect(rolled.restored).toBe(true);
    expect(rolled.postHash).toBe(hash);
  });
});
