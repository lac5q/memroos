// @vitest-environment node
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  approveImportProposal,
  detectSkillChange,
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
  vi.restoreAllMocks();
});

describe("skill-sync-governance batch32 — audit table tolerance", () => {
  // sticky: approveImportProposal `if (!updated)` guard (794) — update always returns a row in normal SQLite flows.

  it("approveImportProposal succeeds when audit_entries table is dropped (line 480)", () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS audit_entries");
    const detected = detectSkillChange(database, {
      source_harness: "codex",
      skill_name: `gov-b32-approve-${crypto.randomUUID().slice(0, 8)}`,
      proposed_by: "operator",
      detected_content_body: "body batch32 approve",
    });
    const approved = approveImportProposal(database, detected.proposal.id, "operator", "ok-b32");
    expect(approved.status).toBe("approved");
  });

  it("rejectImportProposal returns when sqlite_master probe throws (line 483)", () => {
    const database = freshDb();
    const detected = detectSkillChange(database, {
      source_harness: "hermes",
      skill_name: `gov-b32-reject-${crypto.randomUUID().slice(0, 8)}`,
      proposed_by: "operator",
      detected_content_body: "body batch32 reject",
    });
    const originalPrepare = database.prepare.bind(database);
    vi.spyOn(database, "prepare").mockImplementation(((sql: string) => {
      if (sql.includes("INSERT INTO audit_entries")) {
        throw new Error("audit insert boom b32");
      }
      if (sql.includes("sqlite_master") && sql.includes("audit_entries")) {
        throw new Error("master probe boom b32");
      }
      return originalPrepare(sql);
    }) as typeof database.prepare);

    const rejected = rejectImportProposal(database, detected.proposal.id, "operator", "no-b32");
    expect(rejected.status).toBe("rejected");
  });
});
