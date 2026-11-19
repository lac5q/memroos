// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  advanceProposalState,
  exportProposal,
  intakeProposal,
  loadIntakeRow,
  recordIntakeRedaction,
  SkillForgeIntakeError,
} from "../intake-export";

let db: Database.Database | null = null;

const SKILLFORGE_INTAKE_DDL = `
  CREATE TABLE IF NOT EXISTS skillforge_intake_proposals (
    id                  TEXT    PRIMARY KEY,
    source_skill_id     TEXT    NOT NULL,
    source_version      TEXT    NOT NULL,
    edit_hash           TEXT    NOT NULL,
    evaluation_hash     TEXT,
    state               TEXT    NOT NULL DEFAULT 'intake_pending',
    scope_key           TEXT    NOT NULL DEFAULT 'default',
    redacted_entry_count INTEGER NOT NULL DEFAULT 0,
    notes               TEXT    NOT NULL DEFAULT '[]',
    created_at          TEXT    NOT NULL,
    updated_at          TEXT    NOT NULL,
    UNIQUE(source_skill_id, source_version, edit_hash)
  );
  CREATE TABLE IF NOT EXISTS skillforge_runtime_exports (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    proposal_id          TEXT    NOT NULL,
    runtime_skill_id     TEXT    NOT NULL,
    runtime_version      TEXT    NOT NULL,
    runtime_content_hash TEXT    NOT NULL,
    edit_hash            TEXT    NOT NULL,
    evaluation_hash      TEXT,
    exported_at          TEXT    NOT NULL,
    exported_by          TEXT    NOT NULL,
    rolled_back_at       TEXT,
    rolled_back_by       TEXT,
    rollback_reason      TEXT,
    UNIQUE(proposal_id)
  );
`;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  db.exec(SKILLFORGE_INTAKE_DDL);
  return db;
}

function seedApprovedProposal(database: Database.Database, proposalId: string): void {
  intakeProposal(database, {
    proposalId,
    sourceSkillId: `skill-${randomUUID().slice(0, 8)}`,
    sourceVersion: "1.0.0",
    proposedDiff: "+ export me",
    actor: "operator",
  });
  for (const state of ["analyzing", "eval_running", "pending_approval", "approved"] as const) {
    advanceProposalState(database, {
      proposalId,
      actor: "operator",
      toState: state,
    });
  }
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("intake-export batch18 — notes parsing, export guards, idempotent keys", () => {
  it("loadIntakeRow tolerates invalid notes JSON via safeParseStringArray", () => {
    const database = freshDb();
    const proposalId = `proposal-${randomUUID()}`;
    intakeProposal(database, {
      proposalId,
      sourceSkillId: "skill.notes",
      sourceVersion: "1.0.0",
      proposedDiff: "diff",
      actor: "operator",
    });
    database
      .prepare(`UPDATE skillforge_intake_proposals SET notes = ? WHERE id = ?`)
      .run("{not-json", proposalId);
    const row = loadIntakeRow(database, proposalId);
    expect(row?.notes).toEqual([]);
  });

  it("intakeProposal returns existing row when duplicate tuple uses a different proposal id", () => {
    const database = freshDb();
    const diff = "shared-diff-body";
    const sourceSkillId = `skill-${randomUUID().slice(0, 8)}`;
    const firstId = `proposal-${randomUUID()}`;
    const secondId = `proposal-${randomUUID()}`;
    const first = intakeProposal(database, {
      proposalId: firstId,
      sourceSkillId,
      sourceVersion: "2.0.0",
      proposedDiff: diff,
      actor: "operator",
    });
    const second = intakeProposal(database, {
      proposalId: secondId,
      sourceSkillId,
      sourceVersion: "2.0.0",
      proposedDiff: diff,
      actor: "operator",
    });
    expect(second.proposalId).toBe(first.proposalId);
    expect(second.proposalId).toBe(firstId);
  });

  it("exportProposal validates required runtime fields and proposal presence", () => {
    const database = freshDb();
    const proposalId = `proposal-${randomUUID()}`;
    expect(() =>
      exportProposal(database, {
        proposalId: "  ",
        runtimeSkillId: "runtime.skill",
        runtimeVersion: "1.0.0",
        runtimeContentHash: "abc",
        actor: "operator",
      }),
    ).toThrow(SkillForgeIntakeError);

    expect(() =>
      exportProposal(database, {
        proposalId,
        runtimeSkillId: "runtime.skill",
        runtimeVersion: "1.0.0",
        runtimeContentHash: "abc",
        actor: "operator",
      }),
    ).toThrow(/not found/);
  });

  it("exportProposal exports an approved proposal into runtime export records", () => {
    const database = freshDb();
    const proposalId = `proposal-${randomUUID()}`;
    seedApprovedProposal(database, proposalId);
    const exported = exportProposal(database, {
      proposalId,
      runtimeSkillId: "runtime.exported",
      runtimeVersion: "9.9.9",
      runtimeContentHash: "f".repeat(64),
      actor: "operator",
    });
    expect(exported.runtimeSkillId).toBe("runtime.exported");
    expect(loadIntakeRow(database, proposalId)?.state).toBe("exported");
  });

  it("recordIntakeRedaction rejects proposals outside intake_pending", () => {
    const database = freshDb();
    const proposalId = `proposal-${randomUUID()}`;
    seedApprovedProposal(database, proposalId);
    expect(() =>
      recordIntakeRedaction(database, {
        proposalId,
        actor: "operator",
        redactedEntryCount: 1,
        scopeKey: "tenant/default",
      }),
    ).toThrow(/only 'intake_pending'/);
  });
});
