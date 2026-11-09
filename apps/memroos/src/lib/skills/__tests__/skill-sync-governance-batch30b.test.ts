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

describe("skill-sync-governance batch30b — audit catch paths", () => {
  it("writeAuditEntry returns early when audit_entries table missing (lines 480–481)", () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS audit_entries");
    const detected = detectSkillChange(database, {
      source_harness: "codex",
      skill_name: `gov-b30b-miss-${crypto.randomUUID().slice(0, 6)}`,
      proposed_by: "operator",
      detected_content_body: "body batch30b",
    });
    const approved = approveImportProposal(database, detected.proposal.id, "operator", "ok");
    expect(approved.status).toBe("approved");
  });

  it("writeAuditEntry swallows sqlite_master probe failures (lines 482–483)", () => {
    const database = freshDb();
    const detected = detectSkillChange(database, {
      source_harness: "hermes",
      skill_name: `gov-b30b-probe-${crypto.randomUUID().slice(0, 6)}`,
      proposed_by: "operator",
      detected_content_body: "body batch30b",
    });
    const originalPrepare = database.prepare.bind(database);
    vi.spyOn(database, "prepare").mockImplementation(((sql: string) => {
      if (sql.includes("INSERT INTO audit_entries")) {
        throw new Error("audit insert boom b30b");
      }
      if (sql.includes("sqlite_master") && sql.includes("audit_entries")) {
        throw new Error("master probe boom b30b");
      }
      return originalPrepare(sql);
    }) as typeof database.prepare);

    const approved = approveImportProposal(database, detected.proposal.id, "operator", "ok");
    expect(approved.status).toBe("approved");
  });

  // unreachable: post-transaction `if (!updated)` at line 794 — updated is set inside the transaction or the transaction throws.
});
