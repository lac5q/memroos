// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { computeContentHash } from "@/lib/skills/registry";

const TMP_ROOT = path.join(os.tmpdir(), `skill-sync-b35b-${crypto.randomUUID()}`);

let db: Database.Database;

const VALID_SKILL_MD = (skillName: string, version: string): string => `---
name: ${skillName}
description: batch35b
owner: ops
source_harness: claude
risk_tier: low
version: ${version}
---

## Body
batch35b
`;

function insertSkillRow(name: string, body: string, hash: string, harness = "claude"): void {
  db.prepare(
    `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
      version, preconditions, allowed_tools, verification_checks, rollback_behavior,
      raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
      evidence_examples, content_hash, trust_level)
     VALUES (?, '', 'ops', ?, 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
  ).run(name, harness, body, new Date().toISOString(), hash);
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

describe("skill-sync batch35b — symlink re-read without raw_body", () => {
  it("approveSyncProposalById skips disk re-verify when symlink refuses readSourceFileContent (1502)", async () => {
    const { createImportProposal, approveSyncProposalById } = await import("../skill-sync");
    const skillName = `symlink-b35b-${crypto.randomUUID().slice(0, 8)}`;
    const bodyV1 = VALID_SKILL_MD(skillName, "1.0.0");
    const bodyV2 = VALID_SKILL_MD(skillName, "2.0.0");
    const hashV2 = computeContentHash(bodyV2);
    const harnessRoot = path.join(TMP_ROOT, "harness-symlink-b35b");
    fs.mkdirSync(harnessRoot, { recursive: true });
    const realFile = path.join(harnessRoot, `real-${skillName}.md`);
    fs.writeFileSync(realFile, bodyV2, "utf8");
    const linkFile = path.join(harnessRoot, `${skillName}.md`);
    fs.symlinkSync(realFile, linkFile);
    insertSkillRow(skillName, bodyV1, computeContentHash(bodyV1));
    const proposal = createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "2.0.0",
        raw_body: bodyV2,
        content_hash: hashV2,
        file_path: linkFile,
      },
      proposed_by: "batch35b",
      source_root: harnessRoot,
    });
    const proposalId = proposal.proposal.pending_proposal_id!;
    db.prepare(`UPDATE skill_sync_state SET pending_diff_payload = ? WHERE pending_proposal_id = ?`).run(
      JSON.stringify({
        source_file_path: linkFile,
        source_root: harnessRoot,
        version: "2.0.0",
      }),
      proposalId,
    );
    const before = db.prepare(`SELECT raw_body FROM skill_registry WHERE name = ?`).get(skillName) as {
      raw_body: string;
    };
    const approved = approveSyncProposalById(db, {
      proposal_id: proposalId,
      operator: "operator-b35b",
    });
    expect(approved.status).toBe("approved");
    const after = db.prepare(`SELECT raw_body FROM skill_registry WHERE name = ?`).get(skillName) as {
      raw_body: string;
    };
    expect(after.raw_body).toBe(before.raw_body);
  });
});
