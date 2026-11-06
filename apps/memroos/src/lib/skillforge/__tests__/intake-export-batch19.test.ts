// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
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

afterEach(() => {
  db?.close();
  db = null;
});

describe("intake-export batch19", () => {
  it("intakeProposal rethrows non-unique insert failures", () => {
    const database = freshDb();
    const proposalId = `proposal-${randomUUID()}`;
    intakeProposal(database, {
      proposalId,
      sourceSkillId: "skill.unique-fail",
      sourceVersion: "1.0.0",
      proposedDiff: "diff-body",
      actor: "operator",
    });
    database.prepare(`CREATE TRIGGER deny_intake_insert BEFORE INSERT ON skillforge_intake_proposals BEGIN SELECT RAISE(ABORT, 'hard fail'); END;`).run();
    expect(() =>
      intakeProposal(database, {
        proposalId: `proposal-${randomUUID()}`,
        sourceSkillId: "skill.other",
        sourceVersion: "9.9.9",
        proposedDiff: "other-diff",
        actor: "operator",
      }),
    ).toThrow(/hard fail/);
  });

  it("recordIntakeRedaction fails when proposal row disappears after update", () => {
    const database = freshDb();
    const proposalId = `proposal-${randomUUID()}`;
    intakeProposal(database, {
      proposalId,
      sourceSkillId: "skill.redact",
      sourceVersion: "1.0.0",
      proposedDiff: "diff",
      actor: "operator",
    });
    database.prepare(`CREATE TRIGGER drop_after_redact AFTER UPDATE ON skillforge_intake_proposals BEGIN DELETE FROM skillforge_intake_proposals WHERE id = NEW.id; END;`).run();
    expect(() =>
      recordIntakeRedaction(database, {
        proposalId,
        actor: "operator",
        redactedEntryCount: 2,
        scopeKey: "tenant/default",
      }),
    ).toThrow(/re-reading proposal after update failed/);
  });

  it("exportProposal requires runtimeContentHash", () => {
    const database = freshDb();
    expect(() =>
      exportProposal(database, {
        proposalId: `proposal-${randomUUID()}`,
        runtimeSkillId: "runtime.skill",
        runtimeVersion: "1.0.0",
        runtimeContentHash: "  ",
        actor: "operator",
      }),
    ).toThrow(/runtimeContentHash is required/);
  });

});
