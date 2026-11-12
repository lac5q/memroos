// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { computeContentHash } from "@/lib/skills/registry";

const TMP_ROOT = path.join(os.tmpdir(), `skill-sync-b30-${crypto.randomUUID()}`);

let db: Database.Database;

const VALID_SKILL_MD = (skillName: string, version: string): string => `---
name: ${skillName}
description: test
owner: ops
source_harness: claude
risk_tier: low
version: ${version}
---

## Preconditions
none

## Allowed Tools
read_file

## Verification Checks
verify

## Rollback
revert

## Evidence Examples
verify
`;

function insertSkillRow(name: string, body: string, hash: string): void {
  db.prepare(
    `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
      version, preconditions, allowed_tools, verification_checks, rollback_behavior,
      raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
      evidence_examples, content_hash, trust_level)
     VALUES (?, '', 'ops', 'claude', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
  ).run(name, body, new Date().toISOString(), hash);
}

beforeEach(() => {
  db = new Database(":memory:");
  initSchema(db);
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TMP_ROOT, { recursive: true });
});

afterEach(() => {
  db.close();
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  const signingKey = path.join(process.cwd(), "data", "skill-signing-key.json");
  if (fs.existsSync(signingKey)) fs.unlinkSync(signingKey);
  vi.restoreAllMocks();
});

describe("skill-sync batch30 — sanitizeJsonPayload, scanner parse_error, approval guard", () => {
  it("createImportProposal stores {} when diff_payload is circular (line 441)", async () => {
    const { createImportProposal } = await import("../skill-sync");
    const skillName = `circular-b30-${crypto.randomUUID().slice(0, 6)}`;
    const body = VALID_SKILL_MD(skillName, "1.0.0");
    insertSkillRow(skillName, body, computeContentHash(body));
    const circular: Record<string, unknown> = { marker: "batch30" };
    circular.self = circular;

    const proposal = createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "2.0.0",
        raw_body: VALID_SKILL_MD(skillName, "2.0.0"),
        content_hash: "b".repeat(64),
      },
      proposed_by: "scanner-b30",
      diff_payload: { circular },
    });
    const row = db
      .prepare(`SELECT pending_diff_payload FROM skill_sync_state WHERE skill_name = ? AND source_harness = 'claude'`)
      .get(skillName) as { pending_diff_payload: string };
    expect(row.pending_diff_payload).toBe("{}");
    expect(proposal.proposal.pending_proposal_id).toBeTruthy();
  });

  it("detectHarnessSkills records parse_error when frontmatter name is missing (lines 737-743)", async () => {
    const { detectHarnessSkills } = await import("../skill-sync");
    const roots = { claude: path.join(TMP_ROOT, "claude"), codex: "", hermes: "", openclaw: "" };
    fs.mkdirSync(roots.claude, { recursive: true });
    fs.writeFileSync(path.join(roots.claude, "unnamed-skill-b30.md"), "# no frontmatter name\n", "utf8");
    const scan = detectHarnessSkills({ roots: roots as never });
    const entry = scan.entries.find((e) => e.skill_name === "unnamed-skill-b30");
    expect(entry?.parse_error).toMatch(/name:|frontmatter/i);
  });

  it("approveSyncProposalById skips disk read when source_root is null (line 1500)", async () => {
    const { createImportProposal, approveSyncProposalById } = await import("../skill-sync");
    const skillName = `no-root-b30-${crypto.randomUUID().slice(0, 6)}`;
    const body = VALID_SKILL_MD(skillName, "1.0.0");
    insertSkillRow(skillName, body, computeContentHash(body));
    const proposal = createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "2.0.0",
        raw_body: VALID_SKILL_MD(skillName, "2.0.0"),
        content_hash: "c".repeat(64),
      },
      proposed_by: "scanner-b30",
      diff_payload: {
        source_file_path: path.join(TMP_ROOT, "outside.md"),
        source_root: null,
      },
    });
    const approved = approveSyncProposalById(db, {
      proposal_id: proposal.proposal.pending_proposal_id!,
      operator: "operator-b30",
    });
    expect(approved.status).toBe("approved");
    expect(approved.reverified_hash).toBeNull();
  });
});
