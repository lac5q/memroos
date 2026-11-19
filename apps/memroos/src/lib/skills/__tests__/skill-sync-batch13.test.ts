// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { getDb, closeDb } from "@/lib/db";

const TMP_ROOT = path.join(os.tmpdir(), `skill-sync-b13-${crypto.randomUUID()}`);

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

function buildHarnessRoots(root: string) {
  return {
    claude: path.join(root, "claude-skills"),
    codex: path.join(root, "codex-skills"),
    hermes: path.join(root, "hermes-skills"),
    openclaw: path.join(root, "openclaw-skills"),
  };
}

function insertSkillRow(overrides: {
    name?: string;
    source_harness?: string;
    content_hash?: string;
    version?: string;
    raw_body?: string;
  } = {}
): number {
  const result = db
    .prepare(
      `INSERT INTO skill_registry (
        name, description, owner, source_harness, risk_tier, dispatch_status,
        version, preconditions, allowed_tools, verification_checks, rollback_behavior,
        raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
        evidence_examples, content_hash, signature, signed_by, signed_at, trust_level,
        public_key_fingerprint
      ) VALUES (
        ?, 'Test', 'ops', ?, 'low', 'enabled',
        ?, 'none', 'read_file', 'verify', 'revert',
        ?, 100, '[]', 'operator', ?, 'check', ?, NULL, NULL, NULL, 'unsigned', NULL
      )`
    )
    .run(
      overrides.name ?? "batch13-skill",
      overrides.source_harness ?? "claude",
      overrides.version ?? "1.0.0",
      overrides.raw_body ?? VALID_SKILL_MD(overrides.name ?? "batch13-skill", overrides.version ?? "1.0.0"),
      new Date().toISOString(),
      overrides.content_hash ?? "0".repeat(64)
    );
  return Number(result.lastInsertRowid);
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

describe("skill-sync batch13 — row vanished and scanner edge paths", () => {
  it("createImportProposal throws when sync_state row cannot be read back", async () => {
    const { createImportProposal } = await import("../skill-sync");
    insertSkillRow({ name: "vanish-create", content_hash: "0".repeat(64) });
    db.exec(`
      CREATE TRIGGER skill_sync_vanish_after_insert
      AFTER INSERT ON skill_sync_state
      WHEN NEW.skill_name = 'vanish-create'
      BEGIN
        DELETE FROM skill_sync_state WHERE skill_name = NEW.skill_name AND source_harness = NEW.source_harness;
      END;
    `);
    expect(() =>
      createImportProposal(db, {
        source_harness: "claude",
        detected: {
          skill_name: "vanish-create",
          source_harness: "claude",
          version: "2.0.0",
          raw_body: VALID_SKILL_MD("vanish-create", "2.0.0"),
          content_hash: "1".repeat(64),
        },
        proposed_by: "scanner",
      })
    ).toThrow(/failed to read back skill_sync_state/);
  });

  it("approveImportProposal throws when sync_state row vanishes after approve", async () => {
    const { createImportProposal, approveImportProposal } = await import("../skill-sync");
    insertSkillRow({ name: "vanish-approve-import", content_hash: "0".repeat(64) });
    createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: "vanish-approve-import",
        source_harness: "claude",
        version: "2.0.0",
        raw_body: VALID_SKILL_MD("vanish-approve-import", "2.0.0"),
        content_hash: "1".repeat(64),
      },
      proposed_by: "scanner",
    });
    db.exec(`
      CREATE TRIGGER skill_sync_vanish_after_approve_import
      AFTER UPDATE ON skill_sync_state
      WHEN NEW.skill_name = 'vanish-approve-import'
      BEGIN
        DELETE FROM skill_sync_state WHERE skill_name = NEW.skill_name AND source_harness = NEW.source_harness;
      END;
    `);
    expect(() =>
      approveImportProposal(db, {
        skill_name: "vanish-approve-import",
        source_harness: "claude",
        operator: "alice",
      })
    ).toThrow(/approveImportProposal: row vanished/);
  });

  it("rejectImportProposal throws when sync_state row vanishes after reject", async () => {
    const { createImportProposal, rejectImportProposal } = await import("../skill-sync");
    insertSkillRow({ name: "vanish-reject-import", content_hash: "0".repeat(64) });
    createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: "vanish-reject-import",
        source_harness: "claude",
        version: "2.0.0",
        raw_body: VALID_SKILL_MD("vanish-reject-import", "2.0.0"),
        content_hash: "1".repeat(64),
      },
      proposed_by: "scanner",
    });
    db.exec(`
      CREATE TRIGGER skill_sync_vanish_after_reject_import
      AFTER UPDATE ON skill_sync_state
      WHEN NEW.skill_name = 'vanish-reject-import'
      BEGIN
        DELETE FROM skill_sync_state WHERE skill_name = NEW.skill_name AND source_harness = NEW.source_harness;
      END;
    `);
    expect(() =>
      rejectImportProposal(db, {
        skill_name: "vanish-reject-import",
        source_harness: "claude",
        operator: "bob",
        reason: "nope",
      })
    ).toThrow(/rejectImportProposal: row vanished/);
  });

  it("pinVersion throws when sync_state row vanishes after pin", async () => {
    const { createImportProposal, pinVersion } = await import("../skill-sync");
    insertSkillRow({ name: "vanish-pin", content_hash: "0".repeat(64) });
    createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: "vanish-pin",
        source_harness: "claude",
        version: "2.0.0",
        raw_body: VALID_SKILL_MD("vanish-pin", "2.0.0"),
        content_hash: "1".repeat(64),
      },
      proposed_by: "scanner",
    });
    db.exec(`
      CREATE TRIGGER skill_sync_vanish_after_pin
      AFTER UPDATE ON skill_sync_state
      WHEN NEW.skill_name = 'vanish-pin'
      BEGIN
        DELETE FROM skill_sync_state WHERE skill_name = NEW.skill_name AND source_harness = NEW.source_harness;
      END;
    `);
    expect(() =>
      pinVersion(db, {
        skill_name: "vanish-pin",
        source_harness: "claude",
        version: "9.9.9",
        actor: "alice",
      })
    ).toThrow(/pinVersion: row vanished/);
  });

  it("approveImportProposal inserts registry row when none exists yet", async () => {
    const { createImportProposal, approveImportProposal } = await import("../skill-sync");
    const skillName = `new-registry-${crypto.randomUUID().slice(0, 8)}`;
    const hash = "2".repeat(64);
    createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "1.0.0",
        raw_body: VALID_SKILL_MD(skillName, "1.0.0"),
        content_hash: hash,
      },
      proposed_by: "scanner",
    });
    approveImportProposal(db, {
      skill_name: skillName,
      source_harness: "claude",
      operator: "alice",
    });
    const reg = db
      .prepare(`SELECT content_hash, dispatch_status FROM skill_registry WHERE name = ? AND source_harness = ?`)
      .get(skillName, "claude") as { content_hash: string; dispatch_status: string };
    expect(reg.content_hash).toBe(hash);
    expect(reg.dispatch_status).toBe("quarantined");
  });

  it("rejectSyncProposalById refuses when proposal was already approved", async () => {
    const { createImportProposal, approveSyncProposalById, rejectSyncProposalById } =
      await import("../skill-sync");
    insertSkillRow({ name: "already-approved-id", content_hash: "0".repeat(64) });
    const proposal = createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: "already-approved-id",
        source_harness: "claude",
        version: "2.0.0",
        raw_body: VALID_SKILL_MD("already-approved-id", "2.0.0"),
        content_hash: "1".repeat(64),
      },
      proposed_by: "scanner",
    });
    const proposalId = proposal.proposal.pending_proposal_id!;
    approveSyncProposalById(db, { proposal_id: proposalId, operator: "alice" });
    db.prepare(
      `UPDATE skill_sync_state SET pending_proposal_id = ?, approved_at = NULL, rejected_at = NULL WHERE skill_name = ?`
    ).run(proposalId, "already-approved-id");
    db.prepare(`UPDATE skill_sync_state SET approved_at = ? WHERE pending_proposal_id = ?`).run(
      new Date().toISOString(),
      proposalId
    );
    expect(() =>
      rejectSyncProposalById(db, {
        proposal_id: proposalId,
        operator: "bob",
        reason: "too late",
      })
    ).toThrow(/already approved; cannot reject/);
  });

  it("rollbackToPriorVersion updates registry version/hash when prior_raw_body is absent", async () => {
    const { createImportProposal, approveImportProposal, rollbackToPriorVersion } =
      await import("../skill-sync");
    const hashV1 = "a".repeat(64);
    const hashV2 = "b".repeat(64);
    const id = insertSkillRow({
      name: "rollback-no-body",
      content_hash: hashV1,
      version: "1.0.0",
      raw_body: VALID_SKILL_MD("rollback-no-body", "1.0.0"),
    });
    createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: "rollback-no-body",
        source_harness: "claude",
        version: "2.0.0",
        raw_body: VALID_SKILL_MD("rollback-no-body", "2.0.0"),
        content_hash: hashV2,
      },
      proposed_by: "scanner",
    });
    approveImportProposal(db, {
      skill_name: "rollback-no-body",
      source_harness: "claude",
      operator: "alice",
    });
    db.prepare(`UPDATE skill_sync_state SET pending_diff_payload = '{}' WHERE skill_name = ?`).run(
      "rollback-no-body"
    );
    rollbackToPriorVersion(db, {
      skill_name: "rollback-no-body",
      source_harness: "claude",
      operator: "alice",
    });
    const reg = db
      .prepare(`SELECT version, content_hash FROM skill_registry WHERE id = ?`)
      .get(id) as { version: string; content_hash: string };
    expect(reg.version).toBe("1.0.0");
    expect(reg.content_hash).toBe(hashV1);
  });

  it("detectHarnessSkills records stat errors for unreadable skill files", async () => {
    const { detectHarnessSkills } = await import("../skill-sync");
    const harnessRoots = buildHarnessRoots(TMP_ROOT);
    fs.mkdirSync(harnessRoots.claude, { recursive: true });
    const locked = path.join(harnessRoots.claude, "locked-skill.md");
    fs.writeFileSync(locked, VALID_SKILL_MD("locked-skill", "1.0.0"), "utf8");
    fs.chmodSync(locked, 0o000);
    try {
      const detected = detectHarnessSkills({ roots: harnessRoots });
      expect(
        detected.errors.some(
          (e) =>
            e.file_path === locked &&
            (e.reason.includes("Cannot stat file") || e.reason.includes("Cannot read file"))
        )
      ).toBe(true);
    } finally {
      fs.chmodSync(locked, 0o644);
    }
  });

  it("approveSyncProposalById skips re-read when source_root is null in payload", async () => {
    const { createImportProposal, approveSyncProposalById } = await import("../skill-sync");
    insertSkillRow({ name: "no-source-root", content_hash: "0".repeat(64) });
    const proposal = createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: "no-source-root",
        source_harness: "claude",
        version: "2.0.0",
        raw_body: VALID_SKILL_MD("no-source-root", "2.0.0"),
        content_hash: "1".repeat(64),
      },
      proposed_by: "scanner",
      diff_payload: { source_file_path: "/tmp/missing.md", source_root: null },
    });
    const result = approveSyncProposalById(db, {
      proposal_id: proposal.proposal.pending_proposal_id!,
      operator: "alice",
    });
    expect(result.status).toBe("approved");
    expect(result.reverified_hash).toBeNull();
  });
});
