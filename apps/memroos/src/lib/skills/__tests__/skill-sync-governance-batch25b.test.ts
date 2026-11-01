// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  computeGovernanceContentHash,
  detectSkillChange,
  getImportProposal,
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
});

describe("skill-sync-governance batch25b — reject idempotency and listing", () => {
  it("rejectImportProposal is idempotent when proposal is already rejected", () => {
    const database = freshDb();
    const detected = detectSkillChange(database, {
      source_harness: "codex",
      skill_name: `rej-b25b-${crypto.randomUUID().slice(0, 6)}`,
      proposed_by: "operator",
      detected_content_body: "body batch25b",
    });
    const first = rejectImportProposal(database, detected.proposal.id, "operator", "no batch25b");
    const second = rejectImportProposal(database, detected.proposal.id, "operator", "again");
    expect(first.status).toBe("rejected");
    expect(second.status).toBe("rejected");
    expect(second.decided_at).toBe(first.decided_at);
  });

  it("listImportProposals filters by pending status and getImportProposal loads row", () => {
    const database = freshDb();
    const name = `list-b25b-${crypto.randomUUID().slice(0, 6)}`;
    const detected = detectSkillChange(database, {
      source_harness: "hermes",
      skill_name: name,
      proposed_by: "operator",
      detected_content_body: "listed body",
    });
    const pending = listImportProposals(database, { status: "pending", skill_name: name });
    expect(pending.some((p) => p.id === detected.proposal.id)).toBe(true);
    const loaded = getImportProposal(database, detected.proposal.id);
    expect(loaded?.skill_name).toBe(name);
  });

  it("computeGovernanceContentHash is stable for identical bodies", () => {
    const body = "---\nname: x\n---\n# same";
    const a = computeGovernanceContentHash(body);
    const b = computeGovernanceContentHash(body);
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
});
