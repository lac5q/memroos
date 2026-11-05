// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

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
});

describe("skill-sync-governance batch20 — audit swallow on approve", () => {
  it("approveImportProposal succeeds when audit_entries table is absent", () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS audit_entries");
    const detected = detectSkillChange(database, {
      source_harness: "codex",
      skill_name: `gov-b20-${crypto.randomUUID().slice(0, 6)}`,
      proposed_by: "operator",
      detected_content_body: "body",
    });
    const approved = approveImportProposal(database, detected.proposal.id, "operator", "ok");
    expect(approved.status).toBe("approved");
  });
});
