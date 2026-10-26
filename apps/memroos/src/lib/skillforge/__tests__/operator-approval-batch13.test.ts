// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { applyApprovalAction, getProposal, markApplied, rollbackProposal } from "../operator-approval";
import type { SkillForgeProposal } from "../types";

function makeProposal(id: string, status: string): SkillForgeProposal {
  return {
    id,
    sealProposalId: "seal-1",
    sourceSkillId: "1",
    sourceVersion: "1.0.0",
    proposedDiff: "test diff",
    status: status as SkillForgeProposal["status"],
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

describe("operator-approval batch13", () => {
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
      CREATE TABLE skill_registry (
        id INTEGER PRIMARY KEY,
        version TEXT,
        content_hash TEXT,
        raw_body TEXT,
        imported_at TEXT
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
      CREATE TABLE seal_audit_log (
        proposal_id TEXT,
        event TEXT,
        detail TEXT,
        timestamp TEXT
      );
    `);
    db.prepare(`INSERT INTO skill_registry (id, version, content_hash, raw_body, imported_at) VALUES (1, '1.0.0', ?, 'body', '2026-01-01T00:00:00Z')`).run(
      "0".repeat(64)
    );
  });

  it("getProposal tolerates malformed JSON columns", () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO skillforge_proposals
       (id, seal_proposal_id, source_skill_id, source_version, proposed_diff, status, rejected_edits, residual_risks, created_at, updated_at, validation_results)
       VALUES ('p-bad-json', 'seal', '1', '1.0.0', 'diff', 'pending', 'not-json', '[]', ?, ?, '{bad')`
    ).run(now, now);
    const proposal = getProposal(db, "p-bad-json");
    expect(proposal?.rejectedEdits).toEqual([]);
  });

  it("applyApprovalAction rollback restores registry boundary when export exists", () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO skillforge_proposals
       (id, seal_proposal_id, source_skill_id, source_version, proposed_diff, status, rejected_edits, residual_risks, created_at, updated_at)
       VALUES ('p-rollback', 'seal', '1', '1.0.0', 'diff', 'applied', '[]', '[]', ?, ?)`
    ).run(now, now);
    db.prepare(
      `INSERT INTO skillforge_exports (proposal_id, pre_version, pre_hash, pre_raw_body, created_at)
       VALUES ('p-rollback', '0.9.0', ?, 'prior-body', ?)`
    ).run("1".repeat(64), now);
    const result = applyApprovalAction(db, {
      proposalId: "p-rollback",
      action: "rollback",
      operator: "operator",
      reasoning: "undo",
    });
    expect(result.success).toBe(true);
    expect(result.restored).toBe(true);
    const reg = db.prepare(`SELECT version, raw_body FROM skill_registry WHERE id = 1`).get() as {
      version: string;
      raw_body: string;
    };
    expect(reg.version).toBe("0.9.0");
    expect(reg.raw_body).toBe("prior-body");
  });

  it("rollbackProposal returns not found for missing proposals", () => {
    expect(rollbackProposal(db, "missing", "operator").success).toBe(false);
  });

  it("markApplied rejects non-approved proposals", () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO skillforge_proposals
       (id, source_skill_id, source_version, proposed_diff, status, rejected_edits, residual_risks, created_at, updated_at)
       VALUES ('p-pending', '1', '1.0.0', 'diff', 'pending', '[]', '[]', ?, ?)`
    ).run(now, now);
    expect(markApplied(db, "p-pending").success).toBe(false);
  });
});
