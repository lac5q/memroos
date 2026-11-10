// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { computeContentHash } from "@/lib/skills/registry";
import {
  SyncGovernanceError,
  computeGovernanceContentHash,
  detectSkillChange,
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

describe("skill-sync-governance batch16b", () => {
  it("computeGovernanceContentHash mirrors registry hashing", () => {
    const body = "# Skill body";
    expect(computeGovernanceContentHash(body)).toBe(computeContentHash(body));
  });

  it("detectSkillChange requires hash or body", () => {
    const database = freshDb();
    expect(() =>
      detectSkillChange(database, {
        source_harness: "claude",
        skill_name: "demo",
        proposed_by: "operator",
      }),
    ).toThrow(SyncGovernanceError);
  });

  it("detectSkillChange creates pending proposal for new content", () => {
    const database = freshDb();
    const body = "---\nname: gov-demo\n---\ncontent";
    const hash = computeContentHash(body);
    const result = detectSkillChange(database, {
      source_harness: "codex",
      skill_name: "gov-demo",
      proposed_by: "operator",
      detected_content_body: body,
      version: "1.0.0",
    });
    expect(result.created).toBe(true);
    expect(result.proposal.status).toBe("pending");
    expect(result.proposal.detected_content_hash).toBe(hash);
  });

  it("detectSkillChange dedupes identical pending proposals", () => {
    const database = freshDb();
    const body = "same-body";
    const hash = computeContentHash(body);
    const params = {
      source_harness: "hermes" as const,
      skill_name: `dedupe-${crypto.randomUUID().slice(0, 6)}`,
      proposed_by: "operator",
      detected_content_hash: hash,
    };
    const first = detectSkillChange(database, params);
    const second = detectSkillChange(database, params);
    expect(second.created).toBe(false);
    expect(second.proposal.id).toBe(first.proposal.id);
  });
});
