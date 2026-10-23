/**
 * SkillForge Operator Approval tests — Phase 89
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { listProposals, getProposal, applyApprovalAction, markApplied, rollbackProposal } from "../operator-approval";
import type { SkillForgeProposal } from "../types";

function makeProposal(id: string, status: string): SkillForgeProposal {
  return {
    id,
    sealProposalId: null,
    sourceSkillId: "skill-1",
    sourceVersion: "1.0.0",
    proposedDiff: "test diff",
    status: status as any,
    trainSplitId: null,
    validationResults: null,
    heldOutResults: null,
    wDelta: null,
    rejectedEdits: [],
    residualRisks: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("SkillForge Operator Approval", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE skillforge_proposals (
        id TEXT PRIMARY KEY,
        seal_proposal_id TEXT,
        source_skill_id TEXT NOT NULL,
        source_version TEXT NOT NULL,
        proposed_diff TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        train_split_id TEXT,
        validation_results TEXT,
        held_out_results TEXT,
        w_delta REAL,
        rejected_edits TEXT NOT NULL DEFAULT '[]',
        residual_risks TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE skillforge_exports (
        id INTEGER PRIMARY KEY,
        proposal_id TEXT NOT NULL,
        pre_version TEXT,
        pre_hash TEXT,
        pre_raw_body TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE audit_entries (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        event_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        reason TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL
      );
    `);
  });

  it("lists proposals grouped by status", () => {
    const insert = db.prepare(
      `INSERT INTO skillforge_proposals (id, source_skill_id, source_version, proposed_diff, status, rejected_edits, residual_risks, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insert.run("p1", "skill-1", "1.0.0", "diff1", "pending", "[]", "[]", new Date().toISOString(), new Date().toISOString());
    insert.run("p2", "skill-1", "1.0.0", "diff2", "gated", "[]", "[]", new Date().toISOString(), new Date().toISOString());

    const queue = listProposals(db);
    expect(queue.pending.length).toBe(1);
    expect(queue.gated.length).toBe(1);
  });

  it("gets a proposal by id", () => {
    db.prepare(
      `INSERT INTO skillforge_proposals (id, source_skill_id, source_version, proposed_diff, status, rejected_edits, residual_risks, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("p1", "skill-1", "1.0.0", "diff1", "pending", "[]", "[]", new Date().toISOString(), new Date().toISOString());

    const proposal = getProposal(db, "p1");
    expect(proposal).not.toBeNull();
    expect(proposal?.id).toBe("p1");
  });

  it("returns null for missing proposal", () => {
    const proposal = getProposal(db, "missing");
    expect(proposal).toBeNull();
  });

  it("approves a pending_approval proposal", () => {
    db.prepare(
      `INSERT INTO skillforge_proposals (id, source_skill_id, source_version, proposed_diff, status, rejected_edits, residual_risks, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("p1", "skill-1", "1.0.0", "diff1", "pending_approval", "[]", "[]", new Date().toISOString(), new Date().toISOString());

    const result = applyApprovalAction(db, { proposalId: "p1", action: "approve", operator: "test" });
    expect(result.success).toBe(true);

    const updated = getProposal(db, "p1");
    expect(updated?.status).toBe("approved");
  });

  it("rejects a proposal", () => {
    db.prepare(
      `INSERT INTO skillforge_proposals (id, source_skill_id, source_version, proposed_diff, status, rejected_edits, residual_risks, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("p1", "skill-1", "1.0.0", "diff1", "pending", "[]", "[]", new Date().toISOString(), new Date().toISOString());

    const result = applyApprovalAction(db, { proposalId: "p1", action: "reject", operator: "test" });
    expect(result.success).toBe(true);

    const updated = getProposal(db, "p1");
    expect(updated?.status).toBe("rejected");
  });

  it("fails to approve non-pending_approval proposal", () => {
    db.prepare(
      `INSERT INTO skillforge_proposals (id, source_skill_id, source_version, proposed_diff, status, rejected_edits, residual_risks, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("p1", "skill-1", "1.0.0", "diff1", "pending", "[]", "[]", new Date().toISOString(), new Date().toISOString());

    const result = applyApprovalAction(db, { proposalId: "p1", action: "approve", operator: "test" });
    expect(result.success).toBe(false);
  });

  it("marks applied after approval", () => {
    db.prepare(
      `INSERT INTO skillforge_proposals (id, source_skill_id, source_version, proposed_diff, status, rejected_edits, residual_risks, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("p1", "skill-1", "1.0.0", "diff1", "approved", "[]", "[]", new Date().toISOString(), new Date().toISOString());

    const result = markApplied(db, "p1");
    expect(result.success).toBe(true);

    const updated = getProposal(db, "p1");
    expect(updated?.status).toBe("applied");
  });

  it("fails to mark applied if not approved", () => {
    db.prepare(
      `INSERT INTO skillforge_proposals (id, source_skill_id, source_version, proposed_diff, status, rejected_edits, residual_risks, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("p1", "skill-1", "1.0.0", "diff1", "pending", "[]", "[]", new Date().toISOString(), new Date().toISOString());

    const result = markApplied(db, "p1");
    expect(result.success).toBe(false);
  });

  it("requests changes by moving a gated proposal back to pending", () => {
    db.prepare(
      `INSERT INTO skillforge_proposals (id, source_skill_id, source_version, proposed_diff, status, rejected_edits, residual_risks, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("p-change", "skill-1", "1.0.0", "diff1", "gated", "[]", "[]", new Date().toISOString(), new Date().toISOString());

    const result = applyApprovalAction(db, {
      proposalId: "p-change",
      action: "request_changes",
      operator: "reviewer",
      reasoning: "needs more evidence",
    });
    expect(result.success).toBe(true);
    expect(getProposal(db, "p-change")?.status).toBe("pending");
  });

  it("lists approved and rejected proposals in separate queues", () => {
    const insert = db.prepare(
      `INSERT INTO skillforge_proposals (id, source_skill_id, source_version, proposed_diff, status, rejected_edits, residual_risks, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insert.run("approved-1", "skill-1", "1.0.0", "diff", "approved", "[]", "[]", new Date().toISOString(), new Date().toISOString());
    insert.run("rejected-1", "skill-1", "1.0.0", "diff", "rejected", "[]", "[]", new Date().toISOString(), new Date().toISOString());

    const queue = listProposals(db);
    expect(queue.approved.map((proposal) => proposal.id)).toContain("approved-1");
    expect(queue.rejected.map((proposal) => proposal.id)).toContain("rejected-1");
  });

  it("returns errors for missing proposals and unknown actions", () => {
    const missing = applyApprovalAction(db, { proposalId: "missing", action: "approve", operator: "test" });
    expect(missing.success).toBe(false);
    expect(missing.error).toMatch(/not found/i);

    db.prepare(
      `INSERT INTO skillforge_proposals (id, source_skill_id, source_version, proposed_diff, status, rejected_edits, residual_risks, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("p-unknown", "skill-1", "1.0.0", "diff", "pending", "[]", "[]", new Date().toISOString(), new Date().toISOString());

    const unknown = applyApprovalAction(db, {
      proposalId: "p-unknown",
      action: "launch" as "approve",
      operator: "test",
    });
    expect(unknown.success).toBe(false);
    expect(unknown.error).toMatch(/Unknown action/i);
  });

  it("approves gated proposals and rejects rollback on pending rows", () => {
    db.prepare(
      `INSERT INTO skillforge_proposals (id, source_skill_id, source_version, proposed_diff, status, rejected_edits, residual_risks, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("gated-1", "skill-1", "1.0.0", "diff", "gated", "[]", "[]", new Date().toISOString(), new Date().toISOString());

    const approved = applyApprovalAction(db, { proposalId: "gated-1", action: "approve", operator: "test" });
    expect(approved.success).toBe(true);
    expect(getProposal(db, "gated-1")?.status).toBe("approved");

    db.prepare(
      `INSERT INTO skillforge_proposals (id, source_skill_id, source_version, proposed_diff, status, rejected_edits, residual_risks, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("pending-rollback", "skill-1", "1.0.0", "diff", "pending", "[]", "[]", new Date().toISOString(), new Date().toISOString());

    const rollbackPending = applyApprovalAction(db, {
      proposalId: "pending-rollback",
      action: "rollback",
      operator: "test",
    });
    expect(rollbackPending.success).toBe(false);
    expect(rollbackPending.error).toMatch(/Cannot rollback/i);
  });

  it("rolls back an applied proposal without export history as status-only honesty", () => {
    db.prepare(
      `INSERT INTO skillforge_proposals (id, source_skill_id, source_version, proposed_diff, status, rejected_edits, residual_risks, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("rollback-1", "skill-1", "1.0.0", "diff", "applied", "[]", "[]", new Date().toISOString(), new Date().toISOString());

    const result = rollbackProposal(db, "rollback-1", "operator", "undo export");
    expect(result.success).toBe(true);
    expect(result.restored).toBe(false);
    expect(result.proposalState).toBe("pending_approval");
    expect(getProposal(db, "rollback-1")?.status).toBe("pending_approval");
  });

  it("restores registry content from export history when rolling back", () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS skill_registry (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        source_harness TEXT NOT NULL DEFAULT 'claude',
        version TEXT,
        content_hash TEXT,
        raw_body TEXT NOT NULL DEFAULT '',
        dispatch_status TEXT NOT NULL DEFAULT 'enabled',
        completeness_pct INTEGER NOT NULL DEFAULT 100,
        imported_by TEXT NOT NULL DEFAULT 'operator',
        imported_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.prepare(
      `INSERT INTO skill_registry (id, name, source_harness, version, content_hash, raw_body)
       VALUES (?, ?, 'claude', ?, ?, ?)`
    ).run(42, "rollback-skill", "2.0.0", "b".repeat(64), "post-export body");

    db.prepare(
      `INSERT INTO skillforge_proposals (id, source_skill_id, source_version, proposed_diff, status, rejected_edits, residual_risks, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("rollback-restore", "42", "1.0.0", "diff", "exported", "[]", "[]", new Date().toISOString(), new Date().toISOString());

    db.prepare(
      `INSERT INTO skillforge_exports (proposal_id, pre_version, pre_hash, pre_raw_body, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run("rollback-restore", "1.0.0", "a".repeat(64), "pre-export body", new Date().toISOString());

    const result = rollbackProposal(db, "rollback-restore", "operator", "restore boundary");
    expect(result.success).toBe(true);
    expect(result.restored).toBe(true);
    expect(result.postVersion).toBe("1.0.0");
    const row = db
      .prepare(`SELECT version, raw_body FROM skill_registry WHERE id = ?`)
      .get(42) as { version: string; raw_body: string };
    expect(row.version).toBe("1.0.0");
    expect(row.raw_body).toBe("pre-export body");
  });
});
