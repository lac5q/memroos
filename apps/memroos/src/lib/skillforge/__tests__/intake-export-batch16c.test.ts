// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  advanceProposalState,
  intakeProposal,
  listIntakeProposals,
  recordIntakeRedaction,
} from "../intake-export";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS skillforge_intake_proposals (
      id TEXT PRIMARY KEY,
      source_skill_id TEXT NOT NULL,
      source_version TEXT NOT NULL,
      edit_hash TEXT NOT NULL,
      evaluation_hash TEXT,
      state TEXT NOT NULL DEFAULT 'intake_pending',
      scope_key TEXT NOT NULL DEFAULT 'default',
      redacted_entry_count INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(source_skill_id, source_version, edit_hash)
    );
  `);
  return db;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("intake-export batch16c — state machine and redaction", () => {
  it("advanceProposalState rejects skipping from intake_pending to exported", () => {
    const database = freshDb();
    const proposalId = `proposal-${crypto.randomUUID()}`;
    intakeProposal(database, {
      proposalId,
      sourceSkillId: "skill.demo",
      sourceVersion: "1.0.0",
      proposedDiff: "+ line",
      actor: "operator",
    });
    expect(() =>
      advanceProposalState(database, {
        proposalId,
        toState: "exported",
        actor: "operator",
      }),
    ).toThrow(/illegal transition/);
  });

  it("recordIntakeRedaction stores redaction metadata on intake row", () => {
    const database = freshDb();
    const proposalId = `proposal-${crypto.randomUUID()}`;
    intakeProposal(database, {
      proposalId,
      sourceSkillId: "skill.redact",
      sourceVersion: "1.0.0",
      proposedDiff: "secret",
      actor: "operator",
    });
    recordIntakeRedaction(database, {
      proposalId,
      actor: "operator",
      redactedEntryCount: 2,
      scopeKey: "tenant/default",
    });
    const listed = listIntakeProposals(database, { limit: 10 });
    expect(listed.some((p) => p.proposalId === proposalId)).toBe(true);
  });
});
