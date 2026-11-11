// @vitest-environment node
import crypto from "crypto";
import { createHash } from "crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { applyApprovalAction, rollbackProposal } from "../operator-approval";

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

describe("operator-approval batch31 — seal audit, reject, and honest rollback", () => {
  it("approve writes seal audit log when seal_proposal_id is present", () => {
    const db = operatorDb();
    const proposalId = `prop-${crypto.randomUUID()}`;
    const sealId = `seal-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO skillforge_proposals
         (id, seal_proposal_id, source_skill_id, source_version, proposed_diff, status, created_at, updated_at)
       VALUES (?, ?, '1', '1.0.0', '{}', 'pending_approval', datetime('now'), datetime('now'))`,
    ).run(proposalId, sealId);
    const result = applyApprovalAction(db, {
      proposalId,
      action: "approve",
      operator: "operator-b31",
      reasoning: "looks good",
    });
    expect(result.success).toBe(true);
    const row = db
      .prepare(`SELECT event, detail FROM seal_audit_log WHERE proposal_id = ?`)
      .get(sealId) as { event: string; detail: string };
    expect(row.event).toBe("approved");
    expect(row.detail).toContain("operator-b31");
  });

  it("reject transitions proposal without restore metadata", () => {
    const db = operatorDb();
    const proposalId = `prop-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO skillforge_proposals
         (id, source_skill_id, source_version, proposed_diff, status, created_at, updated_at)
       VALUES (?, '1', '1.0.0', '{}', 'pending_approval', datetime('now'), datetime('now'))`,
    ).run(proposalId);
    const result = applyApprovalAction(db, { proposalId, action: "reject", operator: "operator-b31" });
    expect(result.success).toBe(true);
    expect(result.postState).toBe("rejected");
    expect(result.restored).toBeUndefined();
  });

  it("rollbackProposal stays honest when no export row exists", () => {
    const db = operatorDb();
    const proposalId = `prop-${crypto.randomUUID()}`;
    db.prepare(`INSERT INTO skill_registry (id, version, content_hash, raw_body) VALUES (1, '1.0.0', ?, 'body')`).run(
      createHash("sha256").update("body").digest("hex"),
    );
    db.prepare(
      `INSERT INTO skillforge_proposals
         (id, source_skill_id, source_version, proposed_diff, status, created_at, updated_at)
       VALUES (?, '1', '1.0.0', '{}', 'applied', datetime('now'), datetime('now'))`,
    ).run(proposalId);
    const rolled = rollbackProposal(db, proposalId, "operator-b31", "no export batch31");
    expect(rolled.success).toBe(true);
    expect(rolled.restored).toBe(false);
    expect(rolled.proposalState).toBe("pending_approval");
  });
});
