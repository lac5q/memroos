// @vitest-environment node
import crypto from "crypto";
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

describe("skill-sync-governance batch31 — writeAuditEntry fallbacks", () => {
  // unreachable: approveImportProposal post-tx `if (!updated)` guard (794).

  it("writeAuditEntry returns when audit_entries table is absent (480)", () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS audit_entries");
    const detected = detectSkillChange(database, {
      source_harness: "codex",
      skill_name: `gov-b31-miss-${crypto.randomUUID().slice(0, 8)}`,
      proposed_by: "operator",
      detected_content_body: "body batch31",
    });
    const approved = approveImportProposal(database, detected.proposal.id, "operator", "ok");
    expect(approved.status).toBe("approved");
  });

  it("writeAuditEntry swallows sqlite_master probe errors on reject path (483)", () => {
    const database = freshDb();
    const detected = detectSkillChange(database, {
      source_harness: "hermes",
      skill_name: `gov-b31-reject-${crypto.randomUUID().slice(0, 8)}`,
      proposed_by: "operator",
      detected_content_body: "body batch31",
    });
    const originalPrepare = database.prepare.bind(database);
    vi.spyOn(database, "prepare").mockImplementation(((sql: string) => {
      if (sql.includes("INSERT INTO audit_entries")) {
        throw new Error("audit insert boom b31");
      }
      if (sql.includes("sqlite_master") && sql.includes("audit_entries")) {
        throw new Error("master probe boom b31");
      }
      return originalPrepare(sql);
    }) as typeof database.prepare);

    const rejected = rejectImportProposal(database, detected.proposal.id, "operator", "no");
    expect(rejected.status).toBe("rejected");
  });
});
