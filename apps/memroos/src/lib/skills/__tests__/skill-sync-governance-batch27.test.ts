// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { approveImportProposal, detectSkillChange, rejectImportProposal } from "../skill-sync-governance";

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

describe("skill-sync-governance batch27 — audit catch paths and approve failure guard", () => {
  it("approveImportProposal returns when audit insert fails and audit_entries table is absent (line 480)", () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS audit_entries");
    const detected = detectSkillChange(database, {
      source_harness: "codex",
      skill_name: `gov-b27-miss-${crypto.randomUUID().slice(0, 6)}`,
      proposed_by: "operator",
      detected_content_body: "body batch27",
    });
    const approved = approveImportProposal(database, detected.proposal.id, "operator", "ok");
    expect(approved.status).toBe("approved");
  });

  it("approveImportProposal swallows audit failures when sqlite_master probe throws (line 483)", () => {
    const database = freshDb();
    const detected = detectSkillChange(database, {
      source_harness: "hermes",
      skill_name: `gov-b27-probe-${crypto.randomUUID().slice(0, 6)}`,
      proposed_by: "operator",
      detected_content_body: "body batch27",
    });
    const originalPrepare = database.prepare.bind(database);
    vi.spyOn(database, "prepare").mockImplementation(((sql: string) => {
      if (sql.includes("INSERT INTO audit_entries")) {
        throw new Error("audit insert boom b27");
      }
      if (sql.includes("sqlite_master") && sql.includes("audit_entries")) {
        throw new Error("master probe boom b27");
      }
      return originalPrepare(sql);
    }) as typeof database.prepare);

    const approved = approveImportProposal(database, detected.proposal.id, "operator", "ok");
    expect(approved.status).toBe("approved");
  });

  it("approveImportProposal throws when reload inside transaction returns no row (line 773, 794 guard unreachable on rollback)", () => {
    const database = freshDb();
    const detected = detectSkillChange(database, {
      source_harness: "claude",
      skill_name: `gov-b27-vanish-${crypto.randomUUID().slice(0, 6)}`,
      proposed_by: "operator",
      detected_content_body: "body batch27",
    });
    const proposalId = detected.proposal.id;
    const originalPrepare = database.prepare.bind(database);
    let selectCalls = 0;
    vi.spyOn(database, "prepare").mockImplementation(((sql: string) => {
      const stmt = originalPrepare(sql);
      if (sql.includes("FROM skill_import_proposals") && sql.includes("WHERE id")) {
        return {
          get: (...args: unknown[]) => {
            selectCalls += 1;
            if (selectCalls === 2) return undefined;
            return stmt.get(...args);
          },
          all: stmt.all.bind(stmt),
          run: stmt.run.bind(stmt),
        };
      }
      return stmt;
    }) as typeof database.prepare);

    expect(() => approveImportProposal(database, proposalId, "operator", "ok")).toThrow(/row vanished/);
  });

  it("rejectImportProposal still succeeds when audit write is suppressed like approve path", () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS audit_entries");
    const detected = detectSkillChange(database, {
      source_harness: "opencode",
      skill_name: `gov-b27-rej-${crypto.randomUUID().slice(0, 6)}`,
      proposed_by: "operator",
      detected_content_body: "reject batch27",
    });
    const rejected = rejectImportProposal(database, detected.proposal.id, "operator", "no thanks");
    expect(rejected.status).toBe("rejected");
  });
});
