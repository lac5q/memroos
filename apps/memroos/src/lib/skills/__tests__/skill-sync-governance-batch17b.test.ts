// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { computeContentHash } from "@/lib/skills/registry";
import {
  SyncGovernanceError,
  approveImportProposal,
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
});

describe("skill-sync-governance batch17b — proposal lifecycle edges", () => {
  it("detectSkillChange marks unchanged when registry hash matches detection", () => {
    const database = freshDb();
    const skillName = `unchanged-${crypto.randomUUID().slice(0, 8)}`;
    const body = "---\nname: x\n---\nbody";
    const hash = computeContentHash(body);
    database
      .prepare(
        `INSERT INTO skill_registry (
          name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level, signature, lifecycle_state
        ) VALUES (?, '', 'ops', 'claude', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned', NULL, 'enabled')`,
      )
      .run(skillName, body, new Date().toISOString(), hash);
    const result = detectSkillChange(database, {
      source_harness: "claude",
      skill_name: skillName,
      proposed_by: "operator",
      detected_content_hash: hash,
    });
    expect(result.unchanged).toBe(true);
    expect(result.created).toBe(true);
  });

  it("approveImportProposal refuses non-pending proposals", () => {
    const database = freshDb();
    const body = "body";
    const detected = detectSkillChange(database, {
      source_harness: "codex",
      skill_name: `approve-guard-${crypto.randomUUID().slice(0, 6)}`,
      proposed_by: "operator",
      detected_content_body: body,
    });
    approveImportProposal(database, detected.proposal.id, "operator", "ok");
    expect(() => approveImportProposal(database, detected.proposal.id, "operator", "again")).toThrow(
      SyncGovernanceError,
    );
  });

  it("rejectImportProposal requires a non-empty reason", () => {
    const database = freshDb();
    const detected = detectSkillChange(database, {
      source_harness: "hermes",
      skill_name: `reject-reason-${crypto.randomUUID().slice(0, 6)}`,
      proposed_by: "operator",
      detected_content_body: "reject-me",
    });
    expect(() => rejectImportProposal(database, detected.proposal.id, "operator", "  ")).toThrow(
      /reason is required/i,
    );
    const rejected = rejectImportProposal(database, detected.proposal.id, "operator", "not needed");
    expect(rejected.status).toBe("rejected");
  });

  it("listImportProposals filters by harness and status", () => {
    const database = freshDb();
    const harness = "opencode";
    const nameA = `list-a-${crypto.randomUUID().slice(0, 6)}`;
    const nameB = `list-b-${crypto.randomUUID().slice(0, 6)}`;
    detectSkillChange(database, {
      source_harness: harness,
      skill_name: nameA,
      proposed_by: "operator",
      detected_content_body: "a",
    });
    const second = detectSkillChange(database, {
      source_harness: harness,
      skill_name: nameB,
      proposed_by: "operator",
      detected_content_body: "b",
    });
    rejectImportProposal(database, second.proposal.id, "operator", "cleanup");
    const pending = listImportProposals(database, { source_harness: harness, status: "pending" });
    expect(pending.some((p) => p.skill_name === nameA)).toBe(true);
    expect(pending.some((p) => p.skill_name === nameB)).toBe(false);
  });
});
