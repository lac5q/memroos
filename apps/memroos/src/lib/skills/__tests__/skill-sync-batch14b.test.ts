// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { getDb, closeDb } from "@/lib/db";
import { computeContentHash } from "@/lib/skills/registry";

const fsMockState = vi.hoisted(() => ({
  rootRealpathFail: "",
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    realpathSync: (p: fs.PathLike, ...args: Parameters<typeof actual.realpathSync> extends [infer _A, ...infer R] ? R : never) => {
      if (fsMockState.rootRealpathFail && String(p) === fsMockState.rootRealpathFail) {
        throw new Error("EACCES mock realpath root");
      }
      return actual.realpathSync(p, ...args);
    },
  };
});

const TMP_ROOT = path.join(os.tmpdir(), `skill-sync-b14b-${crypto.randomUUID()}`);

const VALID_SKILL_MD = (skillName: string, version: string, extraFm = ""): string => `---
name: ${skillName}
description: test
owner: ops
source_harness: claude
risk_tier: low
version: ${version}
${extraFm}---

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
  fsMockState.rootRealpathFail = "";
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

describe("skill-sync batch14b — remaining scanner and approval edges", () => {
  it("createImportProposal falls back to {} when diff payload JSON.stringify throws (sanitizeJsonPayload)", async () => {
    const stringifySpy = vi.spyOn(JSON, "stringify").mockImplementation((value) => {
      if (value && typeof value === "object" && "source_file_path" in (value as object)) {
        throw new TypeError("Converting circular structure to JSON");
      }
      return JSON.stringify(value);
    });
    const { createImportProposal } = await import("../skill-sync");
    const skillName = `json-fail-${crypto.randomUUID().slice(0, 8)}`;
    const body = VALID_SKILL_MD(skillName, "1.0.0");
    const proposal = createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "1.0.0",
        raw_body: body,
        content_hash: computeContentHash(body),
        file_path: path.join(TMP_ROOT, "skill.md"),
      },
      proposed_by: "scanner",
      source_root: path.join(TMP_ROOT, "claude-skills"),
    });
    expect(proposal.proposal.pending_diff_payload).toBe("{}");
    stringifySpy.mockRestore();
  });

  it("detectHarnessSkills records empty version frontmatter and symlink harness roots", async () => {
    const { detectHarnessSkills } = await import("../skill-sync");
    const roots = buildHarnessRoots(TMP_ROOT);
    fs.mkdirSync(roots.claude, { recursive: true });
    fs.writeFileSync(
      path.join(roots.claude, "empty-version.md"),
      VALID_SKILL_MD("empty-version", "", "version:\n"),
    );
    const realRoot = roots.codex;
    fs.mkdirSync(realRoot, { recursive: true });
    const linkRoot = path.join(TMP_ROOT, "codex-link-root");
    fs.symlinkSync(realRoot, linkRoot, "dir");
    const scan = detectHarnessSkills({
      roots: { claude: roots.claude, codex: linkRoot } as ReturnType<typeof buildHarnessRoots>,
    });
    expect(scan.entries.some((e) => e.skill_name === "empty-version" && e.version === null)).toBe(true);
    expect(scan.errors.some((e) => e.reason.includes("symlink"))).toBe(true);
  });

  it("detectHarnessSkills records cannot canonicalize root when realpathSync throws", async () => {
    const roots = buildHarnessRoots(TMP_ROOT);
    fs.mkdirSync(roots.hermes, { recursive: true });
    fsMockState.rootRealpathFail = roots.hermes;
    const { detectHarnessSkills } = await import("../skill-sync");
    const result = detectHarnessSkills({ roots: { hermes: roots.hermes } as ReturnType<typeof buildHarnessRoots> });
    expect(result.errors.some((e) => e.reason.includes("Cannot canonicalize root"))).toBe(true);
  });

  it("approveSyncProposalById skips re-read when readSourceFileContent rejects escape paths", async () => {
    const { createImportProposal, approveSyncProposalById } = await import("../skill-sync");
    const skillName = `read-guard-${crypto.randomUUID().slice(0, 8)}`;
    const bodyV1 = VALID_SKILL_MD(skillName, "1.0.0");
    const bodyV2 = VALID_SKILL_MD(skillName, "2.0.0");
    const hashV1 = computeContentHash(bodyV1);
    const hashV2 = computeContentHash(bodyV2);
    const harnessRoot = path.join(TMP_ROOT, "approve-root");
    fs.mkdirSync(harnessRoot, { recursive: true });
    const inside = path.join(harnessRoot, `${skillName}.md`);
    fs.writeFileSync(inside, bodyV2);
    const outside = path.join(TMP_ROOT, "outside.md");
    fs.writeFileSync(outside, bodyV2);
    db.prepare(
      `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
        version, preconditions, allowed_tools, verification_checks, rollback_behavior,
        raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
        evidence_examples, content_hash, trust_level)
       VALUES (?, '', 'ops', 'claude', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
    ).run(skillName, bodyV1, new Date().toISOString(), hashV1);
    const proposal = createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "2.0.0",
        raw_body: bodyV2,
        content_hash: hashV2,
        file_path: inside,
      },
      proposed_by: "scanner",
      source_root: harnessRoot,
    });
    expect(proposal.proposal.pending_proposal_id).toBeTruthy();
    db.prepare(`UPDATE skill_sync_state SET pending_diff_payload = ? WHERE pending_proposal_id = ?`).run(
      JSON.stringify({
        source_file_path: outside,
        source_root: harnessRoot,
        version: "2.0.0",
      }),
      proposal.proposal.pending_proposal_id!,
    );
    const escaped = approveSyncProposalById(db, {
      proposal_id: proposal.proposal.pending_proposal_id!,
      operator: "alice",
    });
    expect(escaped.status).toBe("approved");
  });

  it("rejectSyncProposalById still completes when skill audit builder fails and audit_entries is absent", async () => {
    vi.resetModules();
    vi.doMock("@/lib/audit/skill-chain", () => ({
      buildSkillAuditEntry: () => {
        throw new Error("audit builder boom");
      },
    }));
    const { createImportProposal, rejectSyncProposalById } = await import("../skill-sync");
    const skillName = `reject-audit-${crypto.randomUUID().slice(0, 8)}`;
    const body = VALID_SKILL_MD(skillName, "1.0.0");
    const proposal = createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "1.0.0",
        raw_body: body,
        content_hash: computeContentHash(body),
      },
      proposed_by: "scanner",
    });
    db.exec("DROP TABLE IF EXISTS audit_entries");
    const result = rejectSyncProposalById(db, {
      proposal_id: proposal.proposal.pending_proposal_id!,
      operator: "alice",
      reason: "test reject without audit table",
    });
    expect(result.status).toBe("rejected");
  });
});

/**
 * Blockers:
 * - skill-sync.ts:722-727,737 — dead branches (rawBody assignment cannot throw; skillName always has filename fallback).
 */
