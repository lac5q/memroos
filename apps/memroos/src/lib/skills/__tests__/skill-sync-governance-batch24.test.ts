// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { approveImportProposal, detectSkillChange } from "../skill-sync-governance";

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

describe("skill-sync-governance batch24 — audit swallow paths", () => {
  it("approveImportProposal returns when audit insert fails and audit_entries table is absent", () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS audit_entries");
    const detected = detectSkillChange(database, {
      source_harness: "codex",
      skill_name: `gov-b24-miss-${crypto.randomUUID().slice(0, 6)}`,
      proposed_by: "operator",
      detected_content_body: "body",
    });
    const approved = approveImportProposal(database, detected.proposal.id, "operator", "ok batch24");
    expect(approved.status).toBe("approved");
  });

  it("approveImportProposal swallows audit failures when sqlite_master probe throws", () => {
    const database = freshDb();
    const detected = detectSkillChange(database, {
      source_harness: "codex",
      skill_name: `gov-b24-probe-${crypto.randomUUID().slice(0, 6)}`,
      proposed_by: "operator",
      detected_content_body: "body",
    });
    const originalPrepare = database.prepare.bind(database);
    vi.spyOn(database, "prepare").mockImplementation(((sql: string) => {
      if (sql.includes("INSERT INTO audit_entries")) {
        throw new Error("audit insert boom batch24");
      }
      if (sql.includes("sqlite_master") && sql.includes("audit_entries")) {
        throw new Error("master probe boom batch24");
      }
      return originalPrepare(sql);
    }) as typeof database.prepare);

    const approved = approveImportProposal(database, detected.proposal.id, "operator", "ok batch24");
    expect(approved.status).toBe("approved");
  });
});
