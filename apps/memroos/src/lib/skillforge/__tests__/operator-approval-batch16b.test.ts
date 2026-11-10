// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { applyApprovalAction, getProposal, listProposals } from "../operator-approval";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

function insertProposal(
  database: Database.Database,
  status: string,
): string {
  const id = `sf-${crypto.randomUUID()}`;
  database
    .prepare(
      `INSERT INTO skillforge_proposals
       (id, source_skill_id, source_version, proposed_diff, status, edit_hash)
       VALUES (?, 'skill.demo', '1.0.0', '+ change', ?, ?)`,
    )
    .run(id, status, "a".repeat(64));
  return id;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("operator-approval batch16b", () => {
  it("applyApprovalAction returns error for missing proposal", () => {
    const database = freshDb();
    const result = applyApprovalAction(database, {
      proposalId: "missing",
      action: "approve",
      actor: "operator",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it("applyApprovalAction rejects approve from non-gated status", () => {
    const database = freshDb();
    const id = insertProposal(database, "pending");
    const result = applyApprovalAction(database, {
      proposalId: id,
      action: "approve",
      actor: "operator",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Cannot approve/);
  });

  it("listProposals groups pending and approved queues", () => {
    const database = freshDb();
    const pendingId = insertProposal(database, "pending");
    const approvedId = insertProposal(database, "approved");
    const queue = listProposals(database);
    expect(queue.pending.some((p) => p.id === pendingId)).toBe(true);
    expect(queue.approved.some((p) => p.id === approvedId)).toBe(true);
    expect(getProposal(database, approvedId)?.status).toBe("approved");
  });
});
