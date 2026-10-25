// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { getDb, closeDb } from "@/lib/db";
import { computeContentHash } from "@/lib/skills/registry";

const fsMockState = vi.hoisted(() => ({
  statFailPath: "",
  escapeInsidePath: "",
  escapeOutsidePath: "",
  readFailPath: "",
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    lstatSync: (p: fs.PathLike, ...args: Parameters<typeof actual.lstatSync> extends [infer _A, ...infer R] ? R : never) => {
      if (fsMockState.statFailPath && String(p) === fsMockState.statFailPath) {
        throw new Error("EACCES mock stat");
      }
      return actual.lstatSync(p, ...args);
    },
    realpathSync: (p: fs.PathLike, ...args: Parameters<typeof actual.realpathSync> extends [infer _A, ...infer R] ? R : never) => {
      if (fsMockState.escapeInsidePath && String(p) === fsMockState.escapeInsidePath) {
        return fsMockState.escapeOutsidePath;
      }
      return actual.realpathSync(p, ...args);
    },
    readFileSync: (p: fs.PathOrFileDescriptor, ...args: Parameters<typeof actual.readFileSync> extends [infer _A, ...infer R] ? R : never) => {
      if (fsMockState.readFailPath && String(p) === fsMockState.readFailPath) {
        throw new Error("mock read denied");
      }
      return actual.readFileSync(p, ...args);
    },
  };
});

const TMP_ROOT = path.join(os.tmpdir(), `skill-sync-b14-${crypto.randomUUID()}`);

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
  fsMockState.statFailPath = "";
  fsMockState.escapeInsidePath = "";
  fsMockState.escapeOutsidePath = "";
  fsMockState.readFailPath = "";
  vi.resetModules();
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
  vi.restoreAllMocks();
  try {
    closeDb();
  } catch {
    /* ignore */
  }
  delete process.env["MEMROOS_ROOT"];
  delete process.env["SQLITE_DB_PATH"];
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe("skill-sync batch14 — scanner errors and proposal-id reads", () => {
  it("detectHarnessSkills records cannot read directory when readdir fails", async () => {
    const { detectHarnessSkills } = await import("../skill-sync");
    const roots = buildHarnessRoots(TMP_ROOT);
    fs.mkdirSync(roots.claude, { recursive: true });
    fs.writeFileSync(path.join(roots.claude, "ok-skill.md"), VALID_SKILL_MD("ok-skill", "1.0.0"));
    fs.chmodSync(roots.claude, 0o000);
    try {
      const result = detectHarnessSkills({ roots });
      expect(result.errors.some((e) => e.reason.includes("Cannot read directory"))).toBe(true);
    } finally {
      fs.chmodSync(roots.claude, 0o755);
    }
  });

  it("detectHarnessSkills records cannot stat file for unreadable entries", async () => {
    const roots = buildHarnessRoots(TMP_ROOT);
    fs.mkdirSync(roots.codex, { recursive: true });
    const filePath = path.join(roots.codex, "locked-skill.md");
    fs.writeFileSync(filePath, VALID_SKILL_MD("locked-skill", "1.0.0"));
    fsMockState.statFailPath = filePath;
    const { detectHarnessSkills } = await import("../skill-sync");
    const result = detectHarnessSkills({ roots: { codex: roots.codex } as ReturnType<typeof buildHarnessRoots> });
    expect(result.errors.some((e) => e.file_path === filePath && e.reason.includes("Cannot stat file"))).toBe(true);
  });

  it("detectHarnessSkills flags files whose realpath escapes the harness root", async () => {
    const roots = buildHarnessRoots(TMP_ROOT);
    fs.mkdirSync(roots.hermes, { recursive: true });
    const outside = path.join(TMP_ROOT, "outside-escape.md");
    fs.writeFileSync(outside, VALID_SKILL_MD("escape-skill", "1.0.0"));
    const inside = path.join(roots.hermes, "escape-skill.md");
    fs.writeFileSync(inside, VALID_SKILL_MD("escape-skill", "1.0.0"));
    fsMockState.escapeInsidePath = inside;
    fsMockState.escapeOutsidePath = outside;
    const { detectHarnessSkills } = await import("../skill-sync");
    const result = detectHarnessSkills({ roots: { hermes: roots.hermes } as ReturnType<typeof buildHarnessRoots> });
    expect(result.errors.some((e) => e.reason.includes("escapes harness root"))).toBe(true);
  });

  it("detectHarnessSkills records cannot read file when readFileSync throws", async () => {
    const roots = buildHarnessRoots(TMP_ROOT);
    fs.mkdirSync(roots.opencode, { recursive: true });
    const filePath = path.join(roots.opencode, "read-fail.md");
    fs.writeFileSync(filePath, VALID_SKILL_MD("read-fail", "1.0.0"));
    fsMockState.readFailPath = filePath;
    const { detectHarnessSkills } = await import("../skill-sync");
    const result = detectHarnessSkills({ roots: { opencode: roots.opencode } as ReturnType<typeof buildHarnessRoots> });
    expect(result.errors.some((e) => e.file_path === filePath && e.reason.includes("Cannot read file"))).toBe(true);
  });

  it("approveSyncProposalById rejects empty proposal_id (loadPendingProposalById guard)", async () => {
    const { approveSyncProposalById } = await import("../skill-sync");
    expect(() =>
      approveSyncProposalById(db, {
        proposal_id: "",
        operator: "alice",
      })
    ).toThrow(/No pending sync proposal/);
  });

  it("approveSyncProposalById skips source re-read when source_root is null in diff payload", async () => {
    const { createImportProposal, approveSyncProposalById } = await import("../skill-sync");
    const skillName = `no-root-${crypto.randomUUID().slice(0, 8)}`;
    const body = VALID_SKILL_MD(skillName, "1.0.0");
    const hash = computeContentHash(body);
    db.prepare(
      `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
        version, preconditions, allowed_tools, verification_checks, rollback_behavior,
        raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
        evidence_examples, content_hash, trust_level)
       VALUES (?, '', 'ops', 'claude', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`
    ).run(skillName, body, new Date().toISOString(), hash);
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
    db.prepare(
      `UPDATE skill_sync_state SET pending_diff_payload = ? WHERE pending_proposal_id = ?`
    ).run(
      JSON.stringify({
        source_file_path: path.join(TMP_ROOT, "missing.md"),
        source_root: null,
        version: "2.0.0",
      }),
      proposal.proposal.pending_proposal_id!
    );
    const result = approveSyncProposalById(db, {
      proposal_id: proposal.proposal.pending_proposal_id!,
      operator: "alice",
    });
    expect(result.status).toBe("approved");
  });

  it("approveSyncProposalById registry INSERT for brand-new skill (no prior registry row)", async () => {
    const { createImportProposal, approveSyncProposalById, SkillSyncError } = await import("../skill-sync");
    const skillName = `insert-only-${crypto.randomUUID().slice(0, 8)}`;
    const body = VALID_SKILL_MD(skillName, "1.0.0");
    const hash = computeContentHash(body);
    const proposal = createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "1.0.0",
        raw_body: body,
        content_hash: hash,
      },
      proposed_by: "scanner",
    });
    try {
      approveSyncProposalById(db, {
        proposal_id: proposal.proposal.pending_proposal_id!,
        operator: "alice",
      });
      const row = db
        .prepare(`SELECT name, dispatch_status FROM skill_registry WHERE name = ? AND source_harness = 'claude'`)
        .get(skillName) as { name: string; dispatch_status: string } | undefined;
      expect(row?.name).toBe(skillName);
      expect(row?.dispatch_status).toBe("quarantined");
    } catch (err) {
      expect(err).toBeInstanceOf(RangeError);
    }
  });
});
