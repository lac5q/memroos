// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { computeContentHash } from "@/lib/skills/registry";
import { detectSkillChange, listImportProposals } from "../skill-sync-governance";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

function skillBody(name: string): string {
  return `---\nname: ${name}\nversion: 1.0.0\n---\n# batch28\n`;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("skill-sync-governance batch28 — validation, dedupe, unchanged auto-approve", () => {
  it("detectSkillChange requires hash or body (lines 571-573)", () => {
    const database = freshDb();
    expect(() =>
      detectSkillChange(database, {
        source_harness: "codex",
        skill_name: `missing-body-b28-${crypto.randomUUID().slice(0, 6)}`,
        proposed_by: "operator",
      } as Parameters<typeof detectSkillChange>[1]),
    ).toThrow(/detectSkillChange requires/);
  });

  it("listImportProposals rejects unknown status filter (lines 679-682)", () => {
    const database = freshDb();
    expect(() => listImportProposals(database, { status: "bogus" as never })).toThrow(/Invalid proposal status/);
  });

  it("detectSkillChange dedupes identical pending proposals (lines 598-610)", () => {
    const database = freshDb();
    const skillName = `dedupe-b28-${crypto.randomUUID().slice(0, 6)}`;
    const body = skillBody(skillName);
    const first = detectSkillChange(database, {
      source_harness: "hermes",
      skill_name: skillName,
      proposed_by: "operator",
      detected_content_body: body,
    });
    expect(first.created).toBe(true);
    const second = detectSkillChange(database, {
      source_harness: "hermes",
      skill_name: skillName,
      proposed_by: "operator",
      detected_content_body: body,
    });
    expect(second.created).toBe(false);
    expect(second.proposal.id).toBe(first.proposal.id);
  });

  it("detectSkillChange auto-approves when detected hash matches registry (lines 594-616, 643)", () => {
    const database = freshDb();
    const skillName = `unchanged-b28-${crypto.randomUUID().slice(0, 6)}`;
    const body = skillBody(skillName);
    const hash = computeContentHash(body);
    database
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level)
         VALUES (?, '', 'ops', 'claude', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
      )
      .run(skillName, body, new Date().toISOString(), hash);

    const result = detectSkillChange(database, {
      source_harness: "claude",
      skill_name: skillName,
      proposed_by: "operator",
      detected_content_hash: hash,
    });
    expect(result.unchanged).toBe(true);
    expect(result.proposal.status).toBe("approved");
    expect(result.proposal.decision_reason).toBe("no_change_detected");
  });

  it("serializeDiffPayload falls back to {} for circular diff_payload (lines 387-391)", () => {
    const database = freshDb();
    const skillName = `circ-diff-b28-${crypto.randomUUID().slice(0, 6)}`;
    const circular: Record<string, unknown> = { note: "batch28" };
    circular.self = circular;
    const detected = detectSkillChange(database, {
      source_harness: "opencode",
      skill_name: skillName,
      proposed_by: "operator",
      detected_content_body: skillBody(skillName),
      diff_payload: circular,
    });
    expect(detected.proposal.diff_payload).toBe("{}");
  });
});
