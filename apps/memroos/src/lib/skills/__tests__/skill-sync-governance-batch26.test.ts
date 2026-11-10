// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  SyncGovernanceError,
  approveImportProposal,
  computeGovernanceContentHash,
  detectSkillChange,
  listImportProposals,
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

describe("skill-sync-governance batch26 — audit swallow, listing offsets, reject guards", () => {
  it("approveImportProposal returns when audit insert fails and audit_entries is missing (line 480)", () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS audit_entries");
    const detected = detectSkillChange(database, {
      source_harness: "codex",
      skill_name: `gov-b26-miss-${crypto.randomUUID().slice(0, 6)}`,
      proposed_by: "operator",
      detected_content_body: "body batch26",
    });
    const approved = approveImportProposal(database, detected.proposal.id, "operator", "ok");
    expect(approved.status).toBe("approved");
  });

  it("approveImportProposal swallows audit failures when sqlite_master probe throws (line 483)", () => {
    const database = freshDb();
    const detected = detectSkillChange(database, {
      source_harness: "hermes",
      skill_name: `gov-b26-probe-${crypto.randomUUID().slice(0, 6)}`,
      proposed_by: "operator",
      detected_content_body: "body batch26",
    });
    const originalPrepare = database.prepare.bind(database);
    vi.spyOn(database, "prepare").mockImplementation(((sql: string) => {
      if (sql.includes("INSERT INTO audit_entries")) {
        throw new Error("audit insert boom b26");
      }
      if (sql.includes("sqlite_master") && sql.includes("audit_entries")) {
        throw new Error("master probe boom b26");
      }
      return originalPrepare(sql);
    }) as typeof database.prepare);

    const approved = approveImportProposal(database, detected.proposal.id, "operator", "ok");
    expect(approved.status).toBe("approved");
  });

  it("listImportProposals honors positive offset pagination (lines 702-704)", () => {
    const database = freshDb();
    const prefix = `pag-b26-${crypto.randomUUID().slice(0, 6)}`;
    for (let i = 0; i < 3; i += 1) {
      detectSkillChange(database, {
        source_harness: "codex",
        skill_name: `${prefix}-${i}`,
        proposed_by: "operator",
        detected_content_body: `body ${i}`,
      });
    }
    const page = listImportProposals(database, { status: "pending", limit: 1, offset: 1 });
    expect(page).toHaveLength(1);
  });

  it("rejectImportProposal requires a non-empty rejection reason (line 817-819)", () => {
    const database = freshDb();
    const detected = detectSkillChange(database, {
      source_harness: "claude",
      skill_name: `rej-reason-b26-${crypto.randomUUID().slice(0, 6)}`,
      proposed_by: "operator",
      detected_content_body: "reject body",
    });
    expect(() => rejectImportProposal(database, detected.proposal.id, "operator", "   ")).toThrow(
      SyncGovernanceError,
    );
  });

  it("computeGovernanceContentHash handles empty body via hashContent nullish coalesce (line 320)", () => {
    const hash = computeGovernanceContentHash("");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
