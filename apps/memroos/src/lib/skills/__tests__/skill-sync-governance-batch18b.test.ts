// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { SyncGovernanceError, approveImportProposal, detectSkillChange, rejectImportProposal } from "../skill-sync-governance";

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

describe("skill-sync-governance batch18b — row vanished and audit rethrow paths", () => {
  it("approveImportProposal throws when proposal row disappears inside transaction", () => {
    const database = freshDb();
    const detected = detectSkillChange(database, {
      source_harness: "claude",
      skill_name: `vanish-appr-${crypto.randomUUID().slice(0, 6)}`,
      proposed_by: "operator",
      detected_content_body: "approve body",
    });
    const proposalId = detected.proposal.id;
    const originalPrepare = database.prepare.bind(database);
    let proposalSelectCalls = 0;
    vi.spyOn(database, "prepare").mockImplementation((sql: string) => {
      if (sql.includes("FROM skill_import_proposals") && sql.includes("WHERE id = ?")) {
        proposalSelectCalls += 1;
        if (proposalSelectCalls >= 2) {
          return {
            get: () => undefined,
            all: () => [],
            run: () => ({ changes: 0 }),
          } as ReturnType<typeof database.prepare>;
        }
      }
      return originalPrepare(sql);
    });
    expect(() => approveImportProposal(database, proposalId, "operator", "ok")).toThrow(
      /row vanished/i,
    );
  });

  it("rejectImportProposal throws when proposal row disappears inside transaction", () => {
    const database = freshDb();
    const detected = detectSkillChange(database, {
      source_harness: "hermes",
      skill_name: `vanish-rej-${crypto.randomUUID().slice(0, 6)}`,
      proposed_by: "operator",
      detected_content_body: "reject body",
    });
    const proposalId = detected.proposal.id;
    const originalPrepare = database.prepare.bind(database);
    let proposalSelectCalls = 0;
    vi.spyOn(database, "prepare").mockImplementation((sql: string) => {
      if (sql.includes("FROM skill_import_proposals") && sql.includes("WHERE id = ?")) {
        proposalSelectCalls += 1;
        if (proposalSelectCalls >= 2) {
          return {
            get: () => undefined,
            all: () => [],
            run: () => ({ changes: 0 }),
          } as ReturnType<typeof database.prepare>;
        }
      }
      return originalPrepare(sql);
    });
    expect(() => rejectImportProposal(database, proposalId, "operator", "not needed")).toThrow(
      /row vanished/i,
    );
  });

  it("writeAuditEntry rethrows when audit_entries exists but insert fails", async () => {
    vi.doMock("@/lib/audit/skill-chain", () => ({
      buildSkillAuditEntry: () => {
        throw new Error("audit builder boom");
      },
    }));
    const database = freshDb();
    const { detectSkillChange: detect, approveImportProposal: approve } = await import("../skill-sync-governance");
    const detected = detect(database, {
      source_harness: "codex",
      skill_name: `audit-rethrow-${crypto.randomUUID().slice(0, 6)}`,
      proposed_by: "operator",
      detected_content_body: "body",
    });
    const originalPrepare = database.prepare.bind(database);
    vi.spyOn(database, "prepare").mockImplementation((sql: string) => {
      if (sql.includes("INSERT INTO audit_entries")) {
        throw new Error("forced audit insert failure");
      }
      return originalPrepare(sql);
    });
    expect(() => approve(database, detected.proposal.id, "operator")).toThrow(/forced audit insert failure/);
  });
});
