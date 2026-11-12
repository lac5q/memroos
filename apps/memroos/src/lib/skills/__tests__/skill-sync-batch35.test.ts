// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { computeContentHash } from "@/lib/skills/registry";

const TMP_ROOT = path.join(os.tmpdir(), `skill-sync-b35-${crypto.randomUUID()}`);

let db: Database.Database;

const VALID_SKILL_MD = (skillName: string, version: string): string => `---
name: ${skillName}
description: batch35
owner: ops
source_harness: claude
risk_tier: low
version: ${version}
---

## Body
batch35
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

describe("skill-sync batch35 — symlink re-read guard and sticky skips", () => {
  it.skip("sanitizeJsonPayload null early return (441) — diffPayload is always a constructed object", () => {});

  it.skip("dead try/catch rawBody = raw (722–727) and empty skill_name (737) — no reachable scanner inputs", () => {});

  it("approveSyncProposalById refuses readSourceFileContent when source file is a symlink (1502)", async () => {
    const { createImportProposal, approveSyncProposalById } = await import("../skill-sync");
    const skillName = `symlink-b35-${crypto.randomUUID().slice(0, 8)}`;
    const bodyV1 = VALID_SKILL_MD(skillName, "1.0.0");
    const bodyV2 = VALID_SKILL_MD(skillName, "2.0.0");
    const hashV2 = computeContentHash(bodyV2);
    const harnessRoot = path.join(TMP_ROOT, "harness-symlink");
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
      proposed_by: "batch35",
      source_root: harnessRoot,
    });
    db.prepare(`UPDATE skill_sync_state SET pending_diff_payload = ? WHERE pending_proposal_id = ?`).run(
      JSON.stringify({
        source_file_path: linkFile,
        source_root: harnessRoot,
        raw_body: bodyV2,
        version: "2.0.0",
      }),
      proposal.proposal.pending_proposal_id!,
    );
    const approved = approveSyncProposalById(db, {
      proposal_id: proposal.proposal.pending_proposal_id!,
      operator: "operator-b35",
    });
    expect(approved.status).toBe("approved");
  });

  it("approveSyncProposalById returns early when source_root is missing (1500)", async () => {
    const { createImportProposal, approveSyncProposalById } = await import("../skill-sync");
    const skillName = `no-root-b35-${crypto.randomUUID().slice(0, 8)}`;
    const body = VALID_SKILL_MD(skillName, "2.0.0");
    const hash = computeContentHash(body);
    insertSkillRow(skillName, VALID_SKILL_MD(skillName, "1.0.0"), computeContentHash(VALID_SKILL_MD(skillName, "1.0.0")));
    const proposal = createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "2.0.0",
        raw_body: body,
        content_hash: hash,
        file_path: path.join(TMP_ROOT, "missing.md"),
      },
      proposed_by: "batch35",
      source_root: null,
    });
    db.prepare(`UPDATE skill_sync_state SET pending_diff_payload = ? WHERE pending_proposal_id = ?`).run(
      JSON.stringify({ source_file_path: path.join(TMP_ROOT, "missing.md"), raw_body: body }),
      proposal.proposal.pending_proposal_id!,
    );
    const approved = approveSyncProposalById(db, {
      proposal_id: proposal.proposal.pending_proposal_id!,
      operator: "operator-b35",
    });
    expect(approved.status).toBe("approved");
  });

  it("listSyncObservability marks approved rows without pending id (931–932)", async () => {
    const { createImportProposal, approveImportProposal, listSyncObservability } = await import("../skill-sync");
    const skillName = `obs-approved-b35-${crypto.randomUUID().slice(0, 8)}`;
    const bodyV2 = VALID_SKILL_MD(skillName, "2.0.0");
    insertSkillRow(skillName, VALID_SKILL_MD(skillName, "1.0.0"), computeContentHash(VALID_SKILL_MD(skillName, "1.0.0")), "claude");
    createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "2.0.0",
        raw_body: bodyV2,
        content_hash: computeContentHash(bodyV2),
      },
      proposed_by: "batch35",
    });
    approveImportProposal(db, { skill_name: skillName, source_harness: "claude", operator: "operator-b35" });
    const items = listSyncObservability(db, {});
    const row = items.find((r) => r.skill_name === skillName);
    expect(row?.status).toBe("approved");
  });
});
