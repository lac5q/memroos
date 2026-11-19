// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { getDb, closeDb } from "@/lib/db";
import { computeContentHash } from "@/lib/skills/registry";

const TMP_ROOT = path.join(os.tmpdir(), `skill-sync-b13b-${crypto.randomUUID()}`);

const VALID_SKILL_MD = (skillName: string, version: string): string => `---
name: ${skillName}
description: test
owner: ops
source_harness: claude
risk_tier: low
version: ${version}
---

## body
`;

function buildHarnessRoots(root: string) {
  return {
    claude: path.join(root, "claude-skills"),
    codex: path.join(root, "codex-skills"),
    hermes: path.join(root, "hermes-skills"),
    opencode: path.join(root, "opencode-skills"),
  };
}

let db: import("better-sqlite3").Database;

beforeEach(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  process.env["MEMROOS_ROOT"] = TMP_ROOT;
  process.env["SQLITE_DB_PATH"] = path.join(TMP_ROOT, `db-${crypto.randomUUID()}.db`);
  try {
    closeDb();
  } catch {
    /* ignore */
  }
  db = getDb();
});

afterEach(() => {
  try {
    closeDb();
  } catch {
    /* ignore */
  }
  delete process.env["MEMROOS_ROOT"];
  delete process.env["SQLITE_DB_PATH"];
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe("skill-sync batch13b — scanner and proposal edge paths", () => {
  it("requireHarness rejects unsupported harness identifiers", async () => {
    const { requireHarness, SkillSyncError } = await import("../skill-sync");
    expect(() => requireHarness("openclaw")).toThrow(SkillSyncError);
    expect(() => requireHarness("")).toThrow(/Unsupported source_harness/);
  });

  it("diffSkills throws when detected hash is invalid", async () => {
    const { diffSkills, SkillSyncError } = await import("../skill-sync");
    expect(() =>
      diffSkills(null, {
        skill_name: "x",
        source_harness: "claude",
        content_hash: "not-a-hash",
      })
    ).toThrow(SkillSyncError);
  });

  it("detectHarnessSkills skips symlink harness roots and dot-prefixed files", async () => {
    const { detectHarnessSkills } = await import("../skill-sync");
    const roots = buildHarnessRoots(TMP_ROOT);
    fs.mkdirSync(roots.claude, { recursive: true });
    fs.writeFileSync(path.join(roots.claude, ".hidden-skill.md"), VALID_SKILL_MD("hidden", "1.0.0"));
    fs.writeFileSync(path.join(roots.claude, "visible-skill.md"), VALID_SKILL_MD("visible-skill", "1.0.0"));
    const linkRoot = path.join(TMP_ROOT, "link-root");
    fs.mkdirSync(linkRoot, { recursive: true });
    fs.symlinkSync(linkRoot, roots.codex);
    const result = detectHarnessSkills({ roots: { ...roots, codex: roots.codex } });
    expect(result.entries.some((e) => e.skill_name === "visible-skill")).toBe(true);
    expect(result.entries.some((e) => e.skill_name === "hidden")).toBe(false);
    expect(result.errors.some((e) => e.reason.includes("symlink"))).toBe(true);
  });

  it("detectHarnessSkills flags invalid UTF-8 binary payloads", async () => {
    const { detectHarnessSkills } = await import("../skill-sync");
    const roots = buildHarnessRoots(TMP_ROOT);
    fs.mkdirSync(roots.hermes, { recursive: true });
    const binaryPath = path.join(roots.hermes, "binary-skill.md");
    fs.writeFileSync(binaryPath, Buffer.from([0xff, 0xfe, 0xfd, 0xfc, 0xfb, 0xfa, 0xf9, 0xf8]));
    const result = detectHarnessSkills({ roots });
    expect(result.errors.some((e) => e.file_path === binaryPath && e.reason.includes("UTF-8"))).toBe(true);
  });

  it("rejectSyncProposalById enforces expected_updated_at optimistic lock", async () => {
    const { createImportProposal, rejectSyncProposalById } = await import("../skill-sync");
    const skillName = `stale-reject-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
        version, preconditions, allowed_tools, verification_checks, rollback_behavior,
        raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
        evidence_examples, content_hash, trust_level)
       VALUES (?, '', 'ops', 'claude', 'low', 'enabled', '1.0.0', '', '', '', '', 'body', 100, '[]', 'op', ?, '', ?, 'unsigned')`
    ).run(skillName, new Date().toISOString(), "a".repeat(64));
    const proposal = createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "2.0.0",
        raw_body: VALID_SKILL_MD(skillName, "2.0.0"),
        content_hash: "b".repeat(64),
      },
      proposed_by: "scanner",
    });
    expect(() =>
      rejectSyncProposalById(db, {
        proposal_id: proposal.proposal.pending_proposal_id!,
        operator: "bob",
        reason: "stale",
        expected_updated_at: "1970-01-01T00:00:00.000Z",
      })
    ).toThrow(/Stale concurrent update/);
  });

  it("approveSyncProposalById refuses when on-disk hash drifted since scan", async () => {
    const { createImportProposal, approveSyncProposalById } = await import("../skill-sync");
    const roots = buildHarnessRoots(TMP_ROOT);
    fs.mkdirSync(roots.opencode, { recursive: true });
    const skillName = `hash-drift-${crypto.randomUUID().slice(0, 8)}`;
    const filePath = path.join(roots.opencode, `${skillName}.md`);
    const v1 = VALID_SKILL_MD(skillName, "1.0.0");
    fs.writeFileSync(filePath, v1, "utf8");
    const hashV1 = computeContentHash(v1);
    const proposal = createImportProposal(db, {
      source_harness: "opencode",
      detected: {
        skill_name: skillName,
        source_harness: "opencode",
        version: "1.0.0",
        raw_body: v1,
        content_hash: hashV1,
        file_path: filePath,
      },
      proposed_by: "scanner",
      source_root: roots.opencode,
    });
    fs.writeFileSync(filePath, VALID_SKILL_MD(skillName, "9.9.9"), "utf8");
    expect(() =>
      approveSyncProposalById(db, {
        proposal_id: proposal.proposal.pending_proposal_id!,
        operator: "alice",
      })
    ).toThrow(/Source hash mismatch/);
  });

  it("listSyncObservability marks drift when pending hash differs from last synced", async () => {
    const { createImportProposal, listSyncObservability } = await import("../skill-sync");
    const skillName = `drift-obs-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
        version, preconditions, allowed_tools, verification_checks, rollback_behavior,
        raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
        evidence_examples, content_hash, trust_level)
       VALUES (?, '', 'ops', 'claude', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`
    ).run(skillName, VALID_SKILL_MD(skillName, "1.0.0"), new Date().toISOString(), "a".repeat(64));
    createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "2.0.0",
        raw_body: VALID_SKILL_MD(skillName, "2.0.0"),
        content_hash: "b".repeat(64),
      },
      proposed_by: "scanner",
    });
    const items = listSyncObservability(db, { pending_only: true });
    const item = items.find((i) => i.skill_name === skillName);
    expect(item?.drift).toBe(true);
    expect(item?.status).toBe("pending");
  });

  it("checkSync creates proposals for filesystem drift", async () => {
    const { checkSync } = await import("../skill-sync");
    const roots = buildHarnessRoots(TMP_ROOT);
    fs.mkdirSync(roots.claude, { recursive: true });
    const skillName = `check-sync-${crypto.randomUUID().slice(0, 8)}`;
    const body = VALID_SKILL_MD(skillName, "1.0.0");
    fs.writeFileSync(path.join(roots.claude, `${skillName}.md`), body, "utf8");
    const hash = computeContentHash(body);
    db.prepare(
      `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
        version, preconditions, allowed_tools, verification_checks, rollback_behavior,
        raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
        evidence_examples, content_hash, trust_level)
       VALUES (?, '', 'ops', 'claude', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`
    ).run(skillName, body, new Date().toISOString(), hash);
    const v2 = VALID_SKILL_MD(skillName, "2.0.0");
    fs.writeFileSync(path.join(roots.claude, `${skillName}.md`), v2, "utf8");
    const summary = checkSync(db, { roots, proposed_by: "batch13b" });
    expect(summary.created).toBeGreaterThanOrEqual(1);
    expect(summary.detected).toBeGreaterThanOrEqual(1);
  });
});
