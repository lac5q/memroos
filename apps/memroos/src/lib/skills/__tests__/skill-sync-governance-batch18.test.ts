// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  SyncGovernanceError,
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
  vi.doUnmock("@/lib/audit/skill-chain");
  vi.resetModules();
});

describe("skill-sync-governance batch18 — audit write fallbacks", () => {
  it("approveImportProposal completes when audit_entries table is missing", async () => {
    vi.resetModules();
    vi.doMock("@/lib/audit/skill-chain", () => ({
      buildSkillAuditEntry: () => {
        throw new Error("audit builder boom");
      },
    }));
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS audit_entries");
    const { approveImportProposal: approve, detectSkillChange: detect } = await import("../skill-sync-governance");
    const detected = detect(database, {
      source_harness: "claude",
      skill_name: `gov-appr-${crypto.randomUUID().slice(0, 6)}`,
      proposed_by: "operator",
      detected_content_body: "approve body",
    });
    const approved = approve(database, detected.proposal.id, "operator", "ok");
    expect(approved.status).toBe("approved");
  });

  it("rejectImportProposal survives sqlite_master lookup failure in audit fallback", async () => {
    vi.resetModules();
    vi.doMock("@/lib/audit/skill-chain", () => ({
      buildSkillAuditEntry: () => {
        throw new Error("audit builder boom");
      },
    }));
    const database = freshDb();
    const { detectSkillChange: detect, rejectImportProposal: reject } = await import("../skill-sync-governance");
    const detected = detect(database, {
      source_harness: "codex",
      skill_name: `gov-rej-${crypto.randomUUID().slice(0, 6)}`,
      proposed_by: "operator",
      detected_content_body: "reject body",
    });
    const originalPrepare = database.prepare.bind(database);
    vi.spyOn(database, "prepare").mockImplementation((sql: string) => {
      if (sql.includes("sqlite_master")) {
        throw new Error("mock sqlite_master failure");
      }
      return originalPrepare(sql);
    });
    const rejected = reject(database, detected.proposal.id, "operator", "not needed");
    expect(rejected.status).toBe("rejected");
  });

  it("approveImportProposal throws SyncGovernanceError when proposal id is empty", () => {
    const database = freshDb();
    expect(() => approveImportProposal(database, "", "operator")).toThrow(SyncGovernanceError);
  });
});
