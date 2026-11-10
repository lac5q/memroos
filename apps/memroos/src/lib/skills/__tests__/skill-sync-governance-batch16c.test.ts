// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { computeContentHash } from "@/lib/skills/registry";
import {
  SyncGovernanceError,
  approveImportProposal,
  detectSkillChange,
  getImportProposal,
  rejectImportProposal,
} from "../skill-sync-governance";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("skill-sync-governance batch16c — reject/approve edges", () => {
  it("rejectImportProposal requires non-empty reason", () => {
    const database = freshDb();
    const body = "skill body";
    const created = detectSkillChange(database, {
      source_harness: "claude",
      skill_name: `gov-${crypto.randomUUID().slice(0, 6)}`,
      proposed_by: "operator",
      detected_content_body: body,
    });
    expect(() => rejectImportProposal(database, created.proposal.id, "operator", "  ")).toThrow(
      SyncGovernanceError,
    );
  });

  it("rejectImportProposal is idempotent for already rejected proposals", () => {
    const database = freshDb();
    const created = detectSkillChange(database, {
      source_harness: "hermes",
      skill_name: `rej-${crypto.randomUUID().slice(0, 6)}`,
      proposed_by: "operator",
      detected_content_hash: computeContentHash("payload"),
    });
    rejectImportProposal(database, created.proposal.id, "operator", "not needed");
    const again = rejectImportProposal(database, created.proposal.id, "operator", "duplicate");
    expect(again.status).toBe("rejected");
  });

  it("approveImportProposal rejects proposals not in pending status", () => {
    const database = freshDb();
    const created = detectSkillChange(database, {
      source_harness: "codex",
      skill_name: `appr-${crypto.randomUUID().slice(0, 6)}`,
      proposed_by: "operator",
      detected_content_body: "approve-me",
    });
    rejectImportProposal(database, created.proposal.id, "operator", "reject first");
    expect(() => approveImportProposal(database, created.proposal.id, "operator")).toThrow(
      /Cannot approve/,
    );
  });

  it("getImportProposal returns null for unknown ids", () => {
    const database = freshDb();
    expect(getImportProposal(database, "missing-proposal")).toBeNull();
  });
});
