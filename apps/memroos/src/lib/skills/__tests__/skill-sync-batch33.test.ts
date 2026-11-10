// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { computeContentHash } from "@/lib/skills/registry";

const TMP_ROOT = path.join(os.tmpdir(), `skill-sync-b33-${crypto.randomUUID()}`);

let db: Database.Database;

const VALID_SKILL_MD = (skillName: string, version: string): string => `---
name: ${skillName}
description: batch33
owner: ops
source_harness: claude
risk_tier: low
version: ${version}
---

## Body
batch33
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

describe("skill-sync batch33 — diff branches, scanner stat/escape, audit metadata", () => {
  it.skip("sanitizeJsonPayload null early return (441) — createImportProposal always passes an object into sanitizeJsonPayload", () => {});

  it.skip("dead try/catch around rawBody = raw (722-727) and empty derived skill_name (737) — no reachable scanner inputs", () => {});

  it("diffSkills lists version and raw_body drift when registry hash differs (830-863)", async () => {
    const { diffSkills } = await import("../skill-sync");
    const name = `diff-b33-${crypto.randomUUID().slice(0, 8)}`;
    const v1 = VALID_SKILL_MD(name, "1.0.0");
    const v2 = VALID_SKILL_MD(name, "2.0.0");
    const diff = diffSkills(
      {
        skill_name: name,
        source_harness: "codex",
        version: "1.0.0",
        raw_body: v1,
        content_hash: computeContentHash(v1),
      },
      {
        skill_name: name,
        source_harness: "codex",
        version: "2.0.0",
        raw_body: v2,
        content_hash: computeContentHash(v2),
      },
    );
    expect(diff.kind).toBe("change");
    const fields = diff.changed_fields.map((c) => c.field);
    expect(fields).toContain("version");
    expect(fields).toContain("raw_body");
    expect(fields).toContain("content_hash");
  });

  it("diffSkills returns no_change when hashes match case-insensitively (816-827)", async () => {
    const { diffSkills } = await import("../skill-sync");
    const name = `same-b33-${crypto.randomUUID().slice(0, 8)}`;
    const body = VALID_SKILL_MD(name, "1.0.0");
    const hash = computeContentHash(body).toUpperCase();
    const diff = diffSkills(
      {
        skill_name: name,
        source_harness: "hermes",
        version: "1.0.0",
        raw_body: body,
        content_hash: hash,
      },
      {
        skill_name: name,
        source_harness: "hermes",
        version: "1.0.0",
        raw_body: body,
        content_hash: hash.toLowerCase(),
      },
    );
    expect(diff.kind).toBe("no_change");
  });

  it("diffSkills derives detected hash from raw_body when content_hash is omitted (793)", async () => {
    const { diffSkills } = await import("../skill-sync");
    const name = `hash-b33-${crypto.randomUUID().slice(0, 8)}`;
    const body = VALID_SKILL_MD(name, "1.0.0");
    const diff = diffSkills(null, {
      skill_name: name,
      source_harness: "codex",
      version: "1.0.0",
      raw_body: body,
    });
    expect(diff.kind).toBe("add");
    expect(diff.detected_hash).toBe(computeContentHash(body));
  });

  it("writeAuditEntry records skill-chain metadata when pinVersion succeeds (513)", async () => {
    const skillName = `audit-meta-b33-${crypto.randomUUID().slice(0, 8)}`;
    const body = VALID_SKILL_MD(skillName, "1.0.0");
    insertSkillRow(skillName, body, computeContentHash(body));
    const { pinVersion } = await import("../skill-sync");
    pinVersion(db, {
      skill_name: skillName,
      source_harness: "claude",
      version: "1.0.0",
      actor: `operator-b33-${crypto.randomUUID().slice(0, 6)}`,
    });
    const row = db
      .prepare(`SELECT metadata_json FROM audit_entries WHERE event_type LIKE 'skill.%' ORDER BY created_at DESC LIMIT 1`)
      .get() as { metadata_json: string } | undefined;
    expect(row?.metadata_json).toBeTruthy();
  });

  it("approveSyncProposalById leaves reverified_hash null when source_root is null (1500)", async () => {
    const { createImportProposal, approveSyncProposalById } = await import("../skill-sync");
    const skillName = `null-root-b33-${crypto.randomUUID().slice(0, 8)}`;
    const body = VALID_SKILL_MD(skillName, "1.0.0");
    insertSkillRow(skillName, body, computeContentHash(body));
    const proposal = createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "2.0.0",
        raw_body: VALID_SKILL_MD(skillName, "2.0.0"),
        content_hash: "f".repeat(64),
      },
      proposed_by: "scanner-b33",
      diff_payload: {
        source_file_path: path.join(TMP_ROOT, "foreign-b33.md"),
        source_root: null,
      },
    });
    const approved = approveSyncProposalById(db, {
      proposal_id: proposal.proposal.pending_proposal_id!,
      operator: "operator-b33",
    });
    expect(approved.status).toBe("approved");
    expect(approved.reverified_hash).toBeNull();
  });

  it("listSyncState honors pending_only and pinned_only filters (892-897)", async () => {
    const { createImportProposal, listSyncState, pinVersion } = await import("../skill-sync");
    const pendingName = `pending-b33-${crypto.randomUUID().slice(0, 8)}`;
    const pinnedName = `pinned-b33-${crypto.randomUUID().slice(0, 8)}`;
    insertSkillRow(pendingName, VALID_SKILL_MD(pendingName, "1.0.0"), computeContentHash(VALID_SKILL_MD(pendingName, "1.0.0")));
    insertSkillRow(pinnedName, VALID_SKILL_MD(pinnedName, "1.0.0"), computeContentHash(VALID_SKILL_MD(pinnedName, "1.0.0")));
    createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: pendingName,
        source_harness: "claude",
        version: "2.0.0",
        raw_body: VALID_SKILL_MD(pendingName, "2.0.0"),
        content_hash: "a".repeat(64),
      },
      proposed_by: "batch33",
    });
    pinVersion(db, {
      skill_name: pinnedName,
      source_harness: "claude",
      version: "1.0.0",
      actor: "batch33",
    });
    const pendingRows = listSyncState(db, { pending_only: true });
    const pinnedRows = listSyncState(db, { pinned_only: true });
    expect(pendingRows.some((r) => r.skill_name === pendingName)).toBe(true);
    expect(pinnedRows.some((r) => r.skill_name === pinnedName)).toBe(true);
  });
});
