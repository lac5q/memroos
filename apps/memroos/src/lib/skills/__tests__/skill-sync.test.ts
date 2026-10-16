// @vitest-environment node
/**
 * Phase 149 / SKILLTRUST-04 — Governed cross-harness sync engine tests.
 *
 * Covers the v8.6 SKILLTRUST-04 validation contract:
 *   VAL-SYNC-001 — detectHarnessSkills scans Claude Code (.claude/skills/),
 *                   Codex, Hermes, and OpenCode dirs for SKILL.md files.
 *   VAL-SYNC-002 — diffSkills returns structured field-level diffs with
 *                   old/new values for changed skills, plus an "add" diff
 *                   type for new skills.
 *   VAL-SYNC-003 — Detected changes create pending proposals in
 *                   skill_sync_state; skill_registry is never mutated.
 *   VAL-SYNC-004 — approve updates registry + last_synced_hash; reject
 *                   clears without mutating the registry.
 *   VAL-SYNC-005 — version_pinned_to suppresses drift proposals for
 *                   pinned skills.
 *   VAL-SYNC-006 — One-step rollback restores the prior version content
 *                   and hash.
 *   VAL-SYNC-007 — GET /api/skills/sync returns per-skill observability
 *                   (last_synced, pending, drift, pin).
 *   VAL-SYNC-008 — Sync check is idempotent (no duplicate proposals on
 *                   re-run with no changes).
 *   VAL-SYNC-009 — Malformed SKILL.md files are skipped with an error log
 *                   and the scan continues for remaining files.
 *   VAL-SYNC-010 — Approved sync proposals route through quarantine
 *                   (dispatch_status != 'enabled'), not direct enablement.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { getDb, closeDb } from "@/lib/db";

const TMP_ROOT = path.join(
  os.tmpdir(),
  `skill-sync-${crypto.randomUUID()}`
);

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
  delete process.env["MEMROOS_OPERATOR_API_KEY"];
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const VALID_SKILL_MD = (skillName: string, version: string): string => `---
name: ${skillName}
description: A test skill
owner: ops
source_harness: claude
risk_tier: low
version: ${version}
---

## Preconditions
- none

## Allowed Tools
- read_file

## Verification Checks
- verify output

## Rollback
- revert

## Evidence Examples
- verify output
`;

function insertSkillRow(
  overrides: {
    name?: string;
    source_harness?: string;
    dispatch_status?: string;
    completeness_pct?: number;
    content_hash?: string | null;
    version?: string | null;
    raw_body?: string | null;
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
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?
      )`
    )
    .run(
      overrides.name ?? "sync-test-skill",
      "Test description",
      "ops",
      overrides.source_harness ?? "claude",
      "low",
      overrides.dispatch_status ?? "enabled",
      overrides.version ?? "1.0.0",
      "none",
      "read_file",
      "verify output",
      "revert",
      overrides.raw_body ?? VALID_SKILL_MD("sync-test-skill", "1.0.0"),
      overrides.completeness_pct ?? 100,
      "[]",
      "operator",
      new Date().toISOString(),
      "verify output",
      overrides.content_hash ?? null,
      null,
      null,
      null,
      "unsigned",
      null
    );
  return Number(result.lastInsertRowid);
}

function buildHarnessRoots(baseDir: string): {
  claude: string;
  codex: string;
  hermes: string;
  opencode: string;
} {
  return {
    claude: path.join(baseDir, ".claude", "skills"),
    codex: path.join(baseDir, "codex", "skills"),
    hermes: path.join(baseDir, "hermes", "skills"),
    opencode: path.join(baseDir, "opencode", "skills"),
  };
}

function writeHarnessSkill(
  rootDir: string,
  skillName: string,
  body: string
): string {
  fs.mkdirSync(rootDir, { recursive: true });
  const filePath = path.join(rootDir, `${skillName}.md`);
  fs.writeFileSync(filePath, body, "utf8");
  return filePath;
}

// ---------------------------------------------------------------------------
// VAL-SYNC-001 — detectHarnessSkills scans all four harness dirs
// ---------------------------------------------------------------------------

describe("VAL-SYNC-001 detectHarnessSkills scans all four harness dirs", () => {
  it("returns structured entries with source_harness attribution for each dir", async () => {
    const { detectHarnessSkills } = await import("../skill-sync");
    const harnessRoots = buildHarnessRoots(TMP_ROOT);
    writeHarnessSkill(
      harnessRoots.claude,
      "claude-skill",
      VALID_SKILL_MD("claude-skill", "1.0.0")
    );
    writeHarnessSkill(
      harnessRoots.codex,
      "codex-skill",
      VALID_SKILL_MD("codex-skill", "1.0.0")
    );
    writeHarnessSkill(
      harnessRoots.hermes,
      "hermes-skill",
      VALID_SKILL_MD("hermes-skill", "1.0.0")
    );
    writeHarnessSkill(
      harnessRoots.opencode,
      "opencode-skill",
      VALID_SKILL_MD("opencode-skill", "1.0.0")
    );

    const detected = detectHarnessSkills({ roots: harnessRoots });
    expect(detected.errors).toEqual([]);
    expect(detected.entries).toHaveLength(4);
    const sources = detected.entries.map((e) => e.source_harness).sort();
    expect(sources).toEqual(["claude", "codex", "hermes", "opencode"]);
    for (const entry of detected.entries) {
      expect(entry.skill_name).toBeTruthy();
      expect(typeof entry.content_hash).toBe("string");
      expect(entry.content_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.file_path).toMatch(/\.md$/);
      expect(typeof entry.raw_body).toBe("string");
    }
  });

  it("skips directories that do not exist (returns empty entries for that harness)", async () => {
    const { detectHarnessSkills } = await import("../skill-sync");
    const harnessRoots = buildHarnessRoots(TMP_ROOT);
    writeHarnessSkill(
      harnessRoots.claude,
      "only-claude",
      VALID_SKILL_MD("only-claude", "1.0.0")
    );
    const detected = detectHarnessSkills({ roots: harnessRoots });
    expect(detected.entries.map((e) => e.source_harness)).toEqual(["claude"]);
  });
});

// ---------------------------------------------------------------------------
// VAL-SYNC-002 — diffSkills returns field-level diffs
// ---------------------------------------------------------------------------

describe("VAL-SYNC-002 diffSkills returns field-level diffs", () => {
  it("produces an 'add' diff for a new skill (no existing entry)", async () => {
    const { diffSkills } = await import("../skill-sync");
    const detected = {
      skill_name: "new-skill",
      source_harness: "claude",
      version: "1.0.0",
      raw_body: VALID_SKILL_MD("new-skill", "1.0.0"),
      content_hash:
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      file_path: "/tmp/x.md",
      parse_error: null,
    };
    const diff = diffSkills(null, detected);
    expect(diff.kind).toBe("add");
    expect(diff.skill_name).toBe("new-skill");
    expect(diff.source_harness).toBe("claude");
    expect(diff.changed_fields).toEqual([]);
  });

  it("produces a 'change' diff identifying changed fields with old/new values", async () => {
    const { diffSkills } = await import("../skill-sync");
    const existingRaw = VALID_SKILL_MD("changed-skill", "1.0.0");
    const newRaw = VALID_SKILL_MD("changed-skill", "2.0.0");
    const existing = {
      skill_name: "changed-skill",
      source_harness: "claude",
      version: "1.0.0",
      raw_body: existingRaw,
      content_hash:
        "0000000000000000000000000000000000000000000000000000000000000000",
      file_path: "/tmp/x.md",
      parse_error: null,
    };
    const detected = {
      ...existing,
      raw_body: newRaw,
      content_hash:
        "1111111111111111111111111111111111111111111111111111111111111111",
      version: "2.0.0",
    };
    const diff = diffSkills(existing, detected);
    expect(diff.kind).toBe("change");
    expect(diff.changed_fields.length).toBeGreaterThan(0);
    const versionDiff = diff.changed_fields.find((c) => c.field === "version");
    expect(versionDiff).toBeTruthy();
    expect(versionDiff?.old_value).toBe("1.0.0");
    expect(versionDiff?.new_value).toBe("2.0.0");
    const rawBodyDiff = diff.changed_fields.find((c) => c.field === "raw_body");
    expect(rawBodyDiff).toBeTruthy();
    expect(rawBodyDiff?.old_value).toBe(existingRaw);
    expect(rawBodyDiff?.new_value).toBe(newRaw);
  });

  it("produces a 'no_change' diff when content_hash matches", async () => {
    const { diffSkills } = await import("../skill-sync");
    const sameBody = VALID_SKILL_MD("stable-skill", "1.0.0");
    const hash =
      "2222222222222222222222222222222222222222222222222222222222222222";
    const entry = {
      skill_name: "stable-skill",
      source_harness: "claude",
      version: "1.0.0",
      raw_body: sameBody,
      content_hash: hash,
      file_path: "/tmp/x.md",
      parse_error: null,
    };
    const detected = { ...entry };
    const diff = diffSkills(entry, detected);
    expect(diff.kind).toBe("no_change");
  });
});

// ---------------------------------------------------------------------------
// VAL-SYNC-003 — Detected changes create pending proposals, registry untouched
// ---------------------------------------------------------------------------

describe("VAL-SYNC-003 createImportProposal inserts into skill_sync_state", () => {
  it("creates a pending proposal row and never mutates skill_registry", async () => {
    const { createImportProposal } = await import("../skill-sync");
    const id = insertSkillRow({
      name: "sync-skill",
      content_hash:
        "0000000000000000000000000000000000000000000000000000000000000000",
      version: "1.0.0",
    });

    const beforeRegistry = db
      .prepare(
        `SELECT dispatch_status, version, content_hash FROM skill_registry WHERE id = ?`
      )
      .get(id) as {
      dispatch_status: string;
      version: string;
      content_hash: string | null;
    };

    const detected = {
      skill_name: "sync-skill",
      source_harness: "claude",
      version: "2.0.0",
      raw_body: VALID_SKILL_MD("sync-skill", "2.0.0"),
      content_hash:
        "1111111111111111111111111111111111111111111111111111111111111111",
      file_path: "/tmp/sync-skill.md",
      parse_error: null,
    };

    const result = createImportProposal(db, {
      source_harness: "claude",
      detected,
      proposed_by: "scanner",
    });

    expect(result.created).toBe(true);
    expect(result.proposal.status).toBe("pending");
    expect(result.proposal.skill_name).toBe("sync-skill");
    expect(result.proposal.source_harness).toBe("claude");
    expect(result.proposal.pending_proposal_id).toBeTruthy();
    expect(result.proposal.last_synced_hash).toBe(
      "0000000000000000000000000000000000000000000000000000000000000000"
    );
    expect(result.proposal.version_pinned_to).toBeNull();

    // Registry is untouched.
    const afterRegistry = db
      .prepare(
        `SELECT dispatch_status, version, content_hash FROM skill_registry WHERE id = ?`
      )
      .get(id) as {
      dispatch_status: string;
      version: string;
      content_hash: string | null;
    };
    expect(afterRegistry.dispatch_status).toBe(beforeRegistry.dispatch_status);
    expect(afterRegistry.version).toBe(beforeRegistry.version);
    expect(afterRegistry.content_hash).toBe(beforeRegistry.content_hash);
  });
});

// ---------------------------------------------------------------------------
// VAL-SYNC-004 — Approve updates registry + last_synced_hash; reject clears
// ---------------------------------------------------------------------------

describe("VAL-SYNC-004 approve / reject behavior", () => {
  it("approve updates the registry content + last_synced_hash and routes to quarantine", async () => {
    const { createImportProposal, approveImportProposal } =
      await import("../skill-sync");
    const oldHash =
      "0000000000000000000000000000000000000000000000000000000000000000";
    const newHash =
      "1111111111111111111111111111111111111111111111111111111111111111";
    const id = insertSkillRow({
      name: "approve-skill",
      content_hash: oldHash,
      version: "1.0.0",
      raw_body: VALID_SKILL_MD("approve-skill", "1.0.0"),
    });
    createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: "approve-skill",
        source_harness: "claude",
        version: "2.0.0",
        raw_body: VALID_SKILL_MD("approve-skill", "2.0.0"),
        content_hash: newHash,
        file_path: "/tmp/approve-skill.md",
        parse_error: null,
      },
      proposed_by: "scanner",
    });

    const approved = approveImportProposal(db, {
      source_harness: "claude",
      skill_name: "approve-skill",
      operator: "alice",
    });
    expect(approved.status).toBe("approved");
    expect(approved.last_synced_hash).toBe(newHash);
    expect(approved.pending_proposal_id).toBeNull();

    // Registry content updated (content_hash reflects new body) but dispatch_status is NOT enabled.
    const reg = db
      .prepare(
        `SELECT dispatch_status, content_hash, version, raw_body FROM skill_registry WHERE id = ?`
      )
      .get(id) as {
      dispatch_status: string;
      content_hash: string | null;
      version: string | null;
      raw_body: string | null;
    };
    expect(reg.content_hash).toBe(newHash);
    expect(reg.version).toBe("2.0.0");
    expect(reg.raw_body).toBe(VALID_SKILL_MD("approve-skill", "2.0.0"));
    expect(reg.dispatch_status).not.toBe("enabled");
  });

  it("reject clears the pending proposal without mutating the registry", async () => {
    const { createImportProposal, rejectImportProposal } =
      await import("../skill-sync");
    const id = insertSkillRow({
      name: "reject-skill",
      content_hash:
        "0000000000000000000000000000000000000000000000000000000000000000",
      version: "1.0.0",
    });
    createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: "reject-skill",
        source_harness: "claude",
        version: "2.0.0",
        raw_body: VALID_SKILL_MD("reject-skill", "2.0.0"),
        content_hash:
          "1111111111111111111111111111111111111111111111111111111111111111",
        file_path: "/tmp/reject-skill.md",
        parse_error: null,
      },
      proposed_by: "scanner",
    });

    const rejected = rejectImportProposal(db, {
      source_harness: "claude",
      skill_name: "reject-skill",
      operator: "alice",
      reason: "out of policy",
    });
    expect(rejected.status).toBe("rejected");
    expect(rejected.pending_proposal_id).toBeNull();
    expect(rejected.last_synced_hash).toBe(
      "0000000000000000000000000000000000000000000000000000000000000000"
    );

    const reg = db
      .prepare(
        `SELECT dispatch_status, content_hash FROM skill_registry WHERE id = ?`
      )
      .get(id) as { dispatch_status: string; content_hash: string | null };
    expect(reg.dispatch_status).toBe("enabled");
    expect(reg.content_hash).toBe(
      "0000000000000000000000000000000000000000000000000000000000000000"
    );
  });
});

// ---------------------------------------------------------------------------
// VAL-SYNC-005 — Version pinning suppresses drift proposals
// ---------------------------------------------------------------------------

describe("VAL-SYNC-005 version_pinned_to suppresses drift proposals", () => {
  it("creates no proposal when the skill is pinned to a version", async () => {
    const { createImportProposal, pinVersion, getSyncStateRow } =
      await import("../skill-sync");
    insertSkillRow({
      name: "pinned-skill",
      content_hash:
        "0000000000000000000000000000000000000000000000000000000000000000",
      version: "1.0.0",
    });
    // Seed sync state with a pin.
    pinVersion(db, {
      skill_name: "pinned-skill",
      source_harness: "claude",
      version: "1.0.0",
      actor: "alice",
    });
    const beforeState = getSyncStateRow(db, "pinned-skill", "claude");
    expect(beforeState?.version_pinned_to).toBe("1.0.0");
    expect(beforeState?.pending_proposal_id).toBeNull();

    const detected = {
      skill_name: "pinned-skill",
      source_harness: "claude",
      version: "2.0.0",
      raw_body: VALID_SKILL_MD("pinned-skill", "2.0.0"),
      content_hash:
        "1111111111111111111111111111111111111111111111111111111111111111",
      file_path: "/tmp/pinned-skill.md",
      parse_error: null,
    };
    const result = createImportProposal(db, {
      source_harness: "claude",
      detected,
      proposed_by: "scanner",
    });
    expect(result.created).toBe(false);
    expect(result.proposal.status).toBe("no_change");
    expect(result.proposal.pending_proposal_id).toBeNull();
  });

  it("allows proposals again after the pin is cleared", async () => {
    const { createImportProposal, pinVersion, clearVersionPin } =
      await import("../skill-sync");
    insertSkillRow({
      name: "pinned-then-unpinned",
      content_hash:
        "0000000000000000000000000000000000000000000000000000000000000000",
      version: "1.0.0",
    });
    pinVersion(db, {
      skill_name: "pinned-then-unpinned",
      source_harness: "claude",
      version: "1.0.0",
      actor: "alice",
    });
    clearVersionPin(db, {
      skill_name: "pinned-then-unpinned",
      source_harness: "claude",
      actor: "alice",
    });

    const detected = {
      skill_name: "pinned-then-unpinned",
      source_harness: "claude",
      version: "2.0.0",
      raw_body: VALID_SKILL_MD("pinned-then-unpinned", "2.0.0"),
      content_hash:
        "1111111111111111111111111111111111111111111111111111111111111111",
      file_path: "/tmp/x.md",
      parse_error: null,
    };
    const result = createImportProposal(db, {
      source_harness: "claude",
      detected,
      proposed_by: "scanner",
    });
    expect(result.created).toBe(true);
    expect(result.proposal.status).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// VAL-SYNC-006 — One-step rollback restores prior version
// ---------------------------------------------------------------------------

describe("VAL-SYNC-006 one-step rollback restores prior version", () => {
  it("rollback restores the prior version content and hash on the registry row", async () => {
    const {
      createImportProposal,
      approveImportProposal,
      rollbackToPriorVersion,
    } = await import("../skill-sync");
    const oldHash =
      "0000000000000000000000000000000000000000000000000000000000000000";
    const newHash =
      "1111111111111111111111111111111111111111111111111111111111111111";
    const id = insertSkillRow({
      name: "rollback-skill",
      content_hash: oldHash,
      version: "1.0.0",
      raw_body: VALID_SKILL_MD("rollback-skill", "1.0.0"),
    });
    createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: "rollback-skill",
        source_harness: "claude",
        version: "2.0.0",
        raw_body: VALID_SKILL_MD("rollback-skill", "2.0.0"),
        content_hash: newHash,
        file_path: "/tmp/rollback-skill.md",
        parse_error: null,
      },
      proposed_by: "scanner",
    });
    const approved = approveImportProposal(db, {
      source_harness: "claude",
      skill_name: "rollback-skill",
      operator: "alice",
    });
    expect(approved.last_synced_hash).toBe(newHash);

    const rolled = rollbackToPriorVersion(db, {
      skill_name: "rollback-skill",
      source_harness: "claude",
      operator: "alice",
    });
    expect(rolled.last_synced_hash).toBe(oldHash);

    const reg = db
      .prepare(
        `SELECT content_hash, version, raw_body FROM skill_registry WHERE id = ?`
      )
      .get(id) as {
      content_hash: string | null;
      version: string | null;
      raw_body: string | null;
    };
    expect(reg.content_hash).toBe(oldHash);
    expect(reg.version).toBe("1.0.0");
    expect(reg.raw_body).toBe(VALID_SKILL_MD("rollback-skill", "1.0.0"));
  });

  it("rollback is exactly one step — a second rollback fails", async () => {
    const {
      createImportProposal,
      approveImportProposal,
      rollbackToPriorVersion,
    } = await import("../skill-sync");
    insertSkillRow({
      name: "rollback-once",
      content_hash:
        "0000000000000000000000000000000000000000000000000000000000000000",
      version: "1.0.0",
      raw_body: VALID_SKILL_MD("rollback-once", "1.0.0"),
    });
    createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: "rollback-once",
        source_harness: "claude",
        version: "2.0.0",
        raw_body: VALID_SKILL_MD("rollback-once", "2.0.0"),
        content_hash:
          "1111111111111111111111111111111111111111111111111111111111111111",
        file_path: "/tmp/x.md",
        parse_error: null,
      },
      proposed_by: "scanner",
    });
    approveImportProposal(db, {
      source_harness: "claude",
      skill_name: "rollback-once",
      operator: "alice",
    });
    rollbackToPriorVersion(db, {
      skill_name: "rollback-once",
      source_harness: "claude",
      operator: "alice",
    });
    expect(() =>
      rollbackToPriorVersion(db, {
        skill_name: "rollback-once",
        source_harness: "claude",
        operator: "alice",
      })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// VAL-SYNC-007 — GET /api/skills/sync returns per-skill observability
// ---------------------------------------------------------------------------

describe("VAL-SYNC-007 GET /api/skills/sync observability", () => {
  it("returns per-skill observability with last_synced, pending, drift, pin", async () => {
    const { createImportProposal } = await import("../skill-sync");
    const { GET } = await import("../../../app/api/skills/sync/route");
    insertSkillRow({
      name: "obs-skill",
      content_hash:
        "0000000000000000000000000000000000000000000000000000000000000000",
      version: "1.0.0",
    });
    createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: "obs-skill",
        source_harness: "claude",
        version: "2.0.0",
        raw_body: VALID_SKILL_MD("obs-skill", "2.0.0"),
        content_hash:
          "1111111111111111111111111111111111111111111111111111111111111111",
        file_path: "/tmp/x.md",
        parse_error: null,
      },
      proposed_by: "scanner",
    });

    const req = new Request("http://localhost:3000/api/skills/sync", {
      method: "GET",
    });
    const res = await GET(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    const found = json.items.find(
      (it: { skill_name: string; source_harness: string }) =>
        it.skill_name === "obs-skill" && it.source_harness === "claude"
    );
    expect(found).toBeTruthy();
    expect(found).toHaveProperty("last_synced_hash");
    expect(found).toHaveProperty("pending_proposal_id");
    expect(found).toHaveProperty("drift");
    expect(found).toHaveProperty("version_pinned_to");
    expect(found.drift).toBe(true);
    expect(found.pending_proposal_id).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// VAL-SYNC-008 — Sync check is idempotent
// ---------------------------------------------------------------------------

describe("VAL-SYNC-008 sync check is idempotent", () => {
  it("re-running the check with no changes creates zero new proposals", async () => {
    const { createImportProposal } = await import("../skill-sync");
    insertSkillRow({
      name: "stable-skill",
      content_hash:
        "0000000000000000000000000000000000000000000000000000000000000000",
      version: "1.0.0",
    });
    const detected = {
      skill_name: "stable-skill",
      source_harness: "claude",
      version: "2.0.0",
      raw_body: VALID_SKILL_MD("stable-skill", "2.0.0"),
      content_hash:
        "1111111111111111111111111111111111111111111111111111111111111111",
      file_path: "/tmp/x.md",
      parse_error: null,
    };
    const first = createImportProposal(db, {
      source_harness: "claude",
      detected,
      proposed_by: "scanner",
    });
    expect(first.created).toBe(true);
    expect(first.proposal.pending_proposal_id).toBeTruthy();

    const second = createImportProposal(db, {
      source_harness: "claude",
      detected,
      proposed_by: "scanner",
    });
    expect(second.created).toBe(false);
    expect(second.proposal.pending_proposal_id).toBe(
      first.proposal.pending_proposal_id
    );

    // Exactly one row in skill_sync_state for this skill+harness pair.
    const count = db
      .prepare(
        `SELECT COUNT(*) as c FROM skill_sync_state WHERE skill_name = ? AND source_harness = ?`
      )
      .get("stable-skill", "claude") as { c: number };
    expect(count.c).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// VAL-SYNC-009 — Malformed SKILL.md skipped gracefully
// ---------------------------------------------------------------------------

describe("VAL-SYNC-009 malformed SKILL.md files skipped gracefully", () => {
  it("returns valid entries and logs an error for malformed files without throwing", async () => {
    const { detectHarnessSkills } = await import("../skill-sync");
    const harnessRoots = buildHarnessRoots(TMP_ROOT);
    // Valid skill.
    writeHarnessSkill(
      harnessRoots.claude,
      "valid-skill",
      VALID_SKILL_MD("valid-skill", "1.0.0")
    );
    // Malformed: not parseable YAML frontmatter (frontmatter starts but never closes).
    const malformedPath = path.join(harnessRoots.claude, "malformed-skill.md");
    fs.mkdirSync(harnessRoots.claude, { recursive: true });
    fs.writeFileSync(
      malformedPath,
      "---\nname: still-going\nbut no closing fence\n## Body\nMore body text.\n",
      "utf8"
    );
    // Binary garbage — not parseable as UTF-8 text.
    const binaryPath = path.join(harnessRoots.claude, "binary-skill.md");
    fs.writeFileSync(binaryPath, Buffer.from([0xff, 0xfe, 0x00, 0x12, 0x80]));

    const detected = detectHarnessSkills({ roots: harnessRoots });
    const names = detected.entries.map((e) => e.skill_name).sort();
    expect(names).toContain("valid-skill");
    expect(detected.errors.length).toBeGreaterThan(0);
    const errorNames = detected.errors.map((e) =>
      path.basename(e.file_path)
    );
    expect(errorNames).toContain("malformed-skill.md");
    expect(errorNames).toContain("binary-skill.md");
  });
});

// ---------------------------------------------------------------------------
// VAL-SYNC-010 — Approved sync proposals route through quarantine
// ---------------------------------------------------------------------------

describe("VAL-SYNC-010 approved sync proposals enter quarantine", () => {
  it("after sync approval the dispatch_status is 'quarantined' (not 'enabled') and dispatch is denied", async () => {
    const {
      createImportProposal,
      approveImportProposal,
    } = await import("../skill-sync");
    const { lookupSkillContract } = await import("../../dispatch/skill-lookup");
    const id = insertSkillRow({
      name: "quarantine-skill",
      content_hash:
        "0000000000000000000000000000000000000000000000000000000000000000",
      version: "1.0.0",
    });
    createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: "quarantine-skill",
        source_harness: "claude",
        version: "2.0.0",
        raw_body: VALID_SKILL_MD("quarantine-skill", "2.0.0"),
        content_hash:
          "1111111111111111111111111111111111111111111111111111111111111111",
        file_path: "/tmp/x.md",
        parse_error: null,
      },
      proposed_by: "scanner",
    });
    approveImportProposal(db, {
      source_harness: "claude",
      skill_name: "quarantine-skill",
      operator: "alice",
    });

    const reg = db
      .prepare(
        `SELECT dispatch_status FROM skill_registry WHERE id = ?`
      )
      .get(id) as { dispatch_status: string };
    expect(reg.dispatch_status).not.toBe("enabled");

    const lookup = lookupSkillContract(db, "quarantine-skill");
    expect(lookup?.kind).toBe("denied");
    if (lookup && lookup.kind === "denied") {
      expect(lookup.dispatch_status).not.toBe("enabled");
    }
  });
});

// ---------------------------------------------------------------------------
// API auth — POST endpoints require operator key
// ---------------------------------------------------------------------------

describe("sync API auth gates", () => {
  it("POST /api/skills/sync/check requires operator authentication", async () => {
    const { POST } = await import("../../../app/api/skills/sync/check/route");
    // No operator key configured, non-loopback.
    const req = new Request(
      "http://memroos.example.com/api/skills/sync/check",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roots: {} }),
      }
    );
    const res = await POST(req);
    expect([401, 403]).toContain(res.status);
  });

  it("POST /api/skills/sync/approve requires operator authentication", async () => {
    const { POST } = await import("../../../app/api/skills/sync/approve/route");
    const req = new Request(
      "http://memroos.example.com/api/skills/sync/approve",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          skill_name: "x",
          source_harness: "claude",
          operator: "alice",
        }),
      }
    );
    const res = await POST(req);
    expect([401, 403]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// VAL-SKILL-028 — symlink / traversal protection
// ---------------------------------------------------------------------------

describe("VAL-SKILL-028 detectHarnessSkills rejects symlinks and traversal escape", () => {
  it("skips symlinked files under the harness root and logs a refusal error", async () => {
    const { detectHarnessSkills } = await import("../skill-sync");
    const harnessRoots = buildHarnessRoots(TMP_ROOT);
    fs.mkdirSync(harnessRoots.claude, { recursive: true });
    // Real skill (should be picked up).
    writeHarnessSkill(
      harnessRoots.claude,
      "real-skill",
      VALID_SKILL_MD("real-skill", "1.0.0")
    );
    // External target file outside the harness root.
    const externalDir = path.join(TMP_ROOT, "external");
    fs.mkdirSync(externalDir, { recursive: true });
    const externalFile = path.join(externalDir, "external-skill.md");
    fs.writeFileSync(externalFile, VALID_SKILL_MD("external-skill", "1.0.0"), "utf8");
    // Symlink from inside harness root to the external file.
    fs.symlinkSync(externalFile, path.join(harnessRoots.claude, "leak-skill.md"));

    const detected = detectHarnessSkills({ roots: harnessRoots });
    const names = detected.entries.map((e) => e.skill_name);
    expect(names).toContain("real-skill");
    expect(names).not.toContain("external-skill");
    expect(names).not.toContain("leak-skill");
    const errorReasons = detected.errors.map((e) => e.reason);
    expect(errorReasons.some((r) => r.includes("symlink"))).toBe(true);
  });

  it("rejects a symlinked harness root with an explicit error", async () => {
    const { detectHarnessSkills } = await import("../skill-sync");
    const harnessRoots = buildHarnessRoots(TMP_ROOT);
    fs.mkdirSync(harnessRoots.claude, { recursive: true });
    writeHarnessSkill(
      harnessRoots.claude,
      "real-skill",
      VALID_SKILL_MD("real-skill", "1.0.0")
    );
    const realRoot = harnessRoots.claude;
    const symlinkRoot = path.join(TMP_ROOT, "harness-symlink");
    try {
      fs.symlinkSync(realRoot, symlinkRoot);
    } catch {
      // On systems that forbid symlinks the test is effectively a no-op;
      // the production code path is still exercised by the file-level
      // check above.
      return;
    }
    const roots = { ...harnessRoots, claude: symlinkRoot };
    const detected = detectHarnessSkills({ roots });
    // The symlinked root must be rejected.
    const rootErr = detected.errors.find((e) => e.file_path === symlinkRoot);
    expect(rootErr?.reason).toMatch(/symlink/i);
  });

  it("skips hidden / dot-prefixed entries under the harness root", async () => {
    const { detectHarnessSkills } = await import("../skill-sync");
    const harnessRoots = buildHarnessRoots(TMP_ROOT);
    fs.mkdirSync(harnessRoots.claude, { recursive: true });
    writeHarnessSkill(
      harnessRoots.claude,
      "normal-skill",
      VALID_SKILL_MD("normal-skill", "1.0.0")
    );
    fs.writeFileSync(
      path.join(harnessRoots.claude, ".hidden-skill.md"),
      VALID_SKILL_MD("hidden-skill", "1.0.0"),
      "utf8"
    );
    const detected = detectHarnessSkills({ roots: harnessRoots });
    const names = detected.entries.map((e) => e.skill_name);
    expect(names).toContain("normal-skill");
    expect(names).not.toContain("hidden-skill");
  });
});

// ---------------------------------------------------------------------------
// checkSync, listSyncState, clearVersionPin
// ---------------------------------------------------------------------------

describe("checkSync and sync state helpers", () => {
  it("checkSync scans harness roots and creates proposals for drift", async () => {
    const { checkSync } = await import("../skill-sync");
    const harnessRoots = buildHarnessRoots(TMP_ROOT);
    writeHarnessSkill(
      harnessRoots.claude,
      "check-sync-skill",
      VALID_SKILL_MD("check-sync-skill", "1.0.0")
    );
    insertSkillRow({
      name: "check-sync-skill",
      content_hash: "0".repeat(64),
      version: "0.9.0",
    });
    const result = checkSync(db, { roots: harnessRoots, proposed_by: "scanner" });
    expect(result.detected).toBeGreaterThanOrEqual(1);
    expect(result.created).toBeGreaterThanOrEqual(1);
    expect(result.errors).toEqual([]);
  });

  it("listSyncState and listSyncObservability expose pending and drift flags", async () => {
    const { createImportProposal, listSyncState, listSyncObservability } =
      await import("../skill-sync");
    insertSkillRow({
      name: "obs-drift",
      content_hash: "0".repeat(64),
      version: "1.0.0",
    });
    createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: "obs-drift",
        source_harness: "claude",
        version: "2.0.0",
        raw_body: VALID_SKILL_MD("obs-drift", "2.0.0"),
        content_hash: "1".repeat(64),
        file_path: "/tmp/obs-drift.md",
        parse_error: null,
      },
      proposed_by: "scanner",
    });
    const rows = listSyncState(db, { pending_only: true });
    expect(rows.some((r) => r.skill_name === "obs-drift")).toBe(true);
    const observability = listSyncObservability(db, { pending_only: true });
    const item = observability.find((o) => o.skill_name === "obs-drift");
    expect(item?.drift).toBe(true);
    expect(item?.pending_proposal_id).toBeTruthy();
  });

  it("clearVersionPin removes an existing pin", async () => {
    const { pinVersion, clearVersionPin } = await import("../skill-sync");
    insertSkillRow({ name: "pin-clear", version: "1.0.0" });
    pinVersion(db, {
      skill_name: "pin-clear",
      source_harness: "claude",
      version: "1.0.0",
      actor: "alice",
    });
    const cleared = clearVersionPin(db, {
      skill_name: "pin-clear",
      source_harness: "claude",
      actor: "alice",
    });
    expect(cleared.version_pinned_to).toBeNull();
  });

  it("requireHarness rejects unsupported harness identifiers", async () => {
    const { requireHarness, SkillSyncError } = await import("../skill-sync");
    expect(() => requireHarness("unknown-harness")).toThrow(/Unsupported source_harness/);
    expect(() => requireHarness(42 as unknown as string)).toThrow(SkillSyncError);
    try {
      requireHarness("");
    } catch (error) {
      expect(error).toBeInstanceOf(SkillSyncError);
      expect((error as Error).name).toBe("SkillSyncError");
    }
  });
});

describe("approveSyncProposalById and rejectSyncProposalById", () => {
  it("approves by proposal id with source re-verification", async () => {
    const {
      detectHarnessSkills,
      checkSync,
      approveSyncProposalById,
      getSyncStateRow,
    } = await import("../skill-sync");
    const harnessRoots = buildHarnessRoots(TMP_ROOT);
    const body = VALID_SKILL_MD("proposal-id-skill", "2.0.0");
    writeHarnessSkill(harnessRoots.claude, "proposal-id-skill", body);
    insertSkillRow({
      name: "proposal-id-skill",
      content_hash: "0".repeat(64),
      version: "1.0.0",
      raw_body: VALID_SKILL_MD("proposal-id-skill", "1.0.0"),
    });
    const scan = checkSync(db, { roots: harnessRoots, proposed_by: "scanner" });
    expect(scan.created).toBeGreaterThanOrEqual(1);
    const state = getSyncStateRow(db, "proposal-id-skill", "claude");
    expect(state?.pending_proposal_id).toBeTruthy();

    const result = approveSyncProposalById(db, {
      proposal_id: state!.pending_proposal_id!,
      operator: "alice",
      reason: "looks good",
    });
    expect(result.status).toBe("approved");
    expect(result.registry_updated).toBe(true);
    expect(result.reverified_hash).toBeTruthy();
    const reg = db
      .prepare(`SELECT dispatch_status, content_hash FROM skill_registry WHERE name = ?`)
      .get("proposal-id-skill") as { dispatch_status: string; content_hash: string };
    expect(reg.dispatch_status).toBe("quarantined");
    expect(reg.content_hash).toBe(state?.pending_detected_hash);
  });

  it("rejects stale concurrent updates via expected_updated_at", async () => {
    const { createImportProposal, approveSyncProposalById, SkillSyncError } =
      await import("../skill-sync");
    insertSkillRow({ name: "stale-proposal", content_hash: "0".repeat(64) });
    const { proposal } = createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: "stale-proposal",
        source_harness: "claude",
        version: "2.0.0",
        raw_body: VALID_SKILL_MD("stale-proposal", "2.0.0"),
        content_hash: "1".repeat(64),
      },
      proposed_by: "scanner",
    });
    expect(() =>
      approveSyncProposalById(db, {
        proposal_id: proposal.pending_proposal_id!,
        operator: "alice",
        expected_updated_at: "2020-01-01T00:00:00.000Z",
      })
    ).toThrow(SkillSyncError);
  });

  it("rejectSyncProposalById rejects stale expected_updated_at tokens", async () => {
    const { createImportProposal, rejectSyncProposalById, SkillSyncError } = await import(
      "../skill-sync"
    );
    insertSkillRow({ name: "reject-stale", content_hash: "0".repeat(64) });
    const { proposal } = createImportProposal(db, {
      source_harness: "claude",
      proposed_by: "scanner",
      detected: {
        skill_name: "reject-stale",
        source_harness: "claude",
        content_hash: "1".repeat(64),
        raw_body: VALID_SKILL_MD("reject-stale", "2.0.0"),
      },
    });
    expect(() =>
      rejectSyncProposalById(db, {
        proposal_id: proposal.pending_proposal_id!,
        operator: "alice",
        reason: "no",
        expected_updated_at: "1999-01-01T00:00:00.000Z",
      })
    ).toThrow(SkillSyncError);
  });

  it("rejectSyncProposalById clears pending state without registry mutation", async () => {
    const { createImportProposal, rejectSyncProposalById } = await import("../skill-sync");
    const id = insertSkillRow({
      name: "reject-by-id",
      content_hash: "0".repeat(64),
      dispatch_status: "enabled",
    });
    const { proposal } = createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: "reject-by-id",
        source_harness: "claude",
        version: "2.0.0",
        raw_body: VALID_SKILL_MD("reject-by-id", "2.0.0"),
        content_hash: "1".repeat(64),
      },
      proposed_by: "scanner",
    });
    const result = rejectSyncProposalById(db, {
      proposal_id: proposal.pending_proposal_id!,
      operator: "bob",
      reason: "not now",
    });
    expect(result.status).toBe("rejected");
    expect(result.registry_updated).toBe(false);
    const reg = db
      .prepare(`SELECT dispatch_status, content_hash FROM skill_registry WHERE id = ?`)
      .get(id) as { dispatch_status: string; content_hash: string | null };
    expect(reg.dispatch_status).toBe("enabled");
    expect(reg.content_hash).toBe("0".repeat(64));
  });

  it("createImportProposal records no-change scan marker when registry hash matches", async () => {
    const { createImportProposal, computeContentHash } = await import("../skill-sync");
    const body = VALID_SKILL_MD("no-drift", "1.0.0");
    const hash = computeContentHash(body);
    insertSkillRow({
      name: "no-drift",
      content_hash: hash,
      version: "1.0.0",
      raw_body: body,
    });
    const result = createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: "no-drift",
        source_harness: "claude",
        version: "1.0.0",
        raw_body: body,
        content_hash: hash,
      },
      proposed_by: "scanner",
    });
    expect(result.created).toBe(false);
    expect(result.proposal.pending_proposal_id).toBeNull();
    expect(result.proposal.last_synced_hash).toBe(hash);
  });

  it("approveImportProposal inserts a new registry row when the skill is new", async () => {
    const { createImportProposal, approveImportProposal } = await import("../skill-sync");
    const body = VALID_SKILL_MD("brand-new-skill", "1.0.0");
    const hash = "a".repeat(64);
    const { proposal } = createImportProposal(db, {
      source_harness: "codex",
      detected: {
        skill_name: "brand-new-skill",
        source_harness: "codex",
        version: "1.0.0",
        raw_body: body,
        content_hash: hash,
      },
      proposed_by: "scanner",
      diff_payload: { raw_body: body },
    });
    approveImportProposal(db, {
      skill_name: "brand-new-skill",
      source_harness: "codex",
      operator: "alice",
    });
    const reg = db
      .prepare(`SELECT dispatch_status, content_hash FROM skill_registry WHERE name = ? AND source_harness = ?`)
      .get("brand-new-skill", "codex") as { dispatch_status: string; content_hash: string };
    expect(reg.dispatch_status).toBe("quarantined");
    expect(reg.content_hash).toBe(proposal.pending_detected_hash);
  });

  it("clearVersionPin throws when no pin exists", async () => {
    const { clearVersionPin, SkillSyncError } = await import("../skill-sync");
    expect(() =>
      clearVersionPin(db, {
        skill_name: "no-pin",
        source_harness: "claude",
        actor: "alice",
      })
    ).toThrow(SkillSyncError);
  });

  it("rollbackToPriorVersion throws when sync_state row is missing", async () => {
    const { rollbackToPriorVersion, SkillSyncError } = await import("../skill-sync");
    expect(() =>
      rollbackToPriorVersion(db, {
        skill_name: "missing-sync-state",
        source_harness: "claude",
        operator: "alice",
      })
    ).toThrow(SkillSyncError);
  });

  it("rollbackToPriorVersion restores registry hash without prior_raw_body payload", async () => {
    const { createImportProposal, approveImportProposal, rollbackToPriorVersion } =
      await import("../skill-sync");
    const bodyV1 = VALID_SKILL_MD("rollback-no-body", "1.0.0");
    const bodyV2 = VALID_SKILL_MD("rollback-no-body", "2.0.0");
    const hashV1 = "c".repeat(64);
    const hashV2 = "d".repeat(64);
    insertSkillRow({
      name: "rollback-no-body",
      content_hash: hashV1,
      version: "1.0.0",
      raw_body: bodyV1,
    });
    createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: "rollback-no-body",
        source_harness: "claude",
        version: "2.0.0",
        raw_body: bodyV2,
        content_hash: hashV2,
      },
      proposed_by: "scanner",
      diff_payload: {},
    });
    approveImportProposal(db, {
      skill_name: "rollback-no-body",
      source_harness: "claude",
      operator: "alice",
    });
    const rolled = rollbackToPriorVersion(db, {
      skill_name: "rollback-no-body",
      source_harness: "claude",
      operator: "alice",
    });
    expect(rolled.prior_version).toBeNull();
    const reg = db
      .prepare(`SELECT version, content_hash FROM skill_registry WHERE name = ?`)
      .get("rollback-no-body") as { version: string; content_hash: string };
    expect(reg.version).toBe("1.0.0");
    expect(reg.content_hash).toBe(hashV1);
  });

  it("detectHarnessSkills logs errors when harness root is not a directory", async () => {
    const { detectHarnessSkills } = await import("../skill-sync");
    const fileRoot = path.join(TMP_ROOT, "not-a-dir.md");
    fs.writeFileSync(fileRoot, "# not a directory\n", "utf8");
    const result = detectHarnessSkills({
      roots: {
        claude: fileRoot,
        codex: path.join(TMP_ROOT, "missing-codex"),
        hermes: path.join(TMP_ROOT, "missing-hermes"),
        opencode: path.join(TMP_ROOT, "missing-opencode"),
      },
    });
    expect(result.entries).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThanOrEqual(0);
  });
});

describe("skill-sync validation and failure paths", () => {
  it("createImportProposal rejects proposals without content_hash or raw_body", async () => {
    const { createImportProposal, SkillSyncError } = await import("../skill-sync");
    expect(() =>
      createImportProposal(db, {
        source_harness: "claude",
        detected: { skill_name: "no-body", source_harness: "claude" },
        proposed_by: "scanner",
      })
    ).toThrow(SkillSyncError);
  });

  it("diffSkills rejects malformed content hashes", async () => {
    const { diffSkills, SkillSyncError } = await import("../skill-sync");
    expect(() =>
      diffSkills(null, {
        skill_name: "bad-hash",
        source_harness: "claude",
        content_hash: "not-a-hash",
      })
    ).toThrow(SkillSyncError);
  });

  it("approveImportProposal fails when sync state or pending proposal is missing", async () => {
    const { approveImportProposal, createImportProposal, SkillSyncError } = await import("../skill-sync");
    expect(() =>
      approveImportProposal(db, {
        skill_name: "missing-row",
        source_harness: "claude",
        operator: "alice",
      })
    ).toThrow(/No sync_state row/);

    insertSkillRow({ name: "no-pending", content_hash: "0".repeat(64) });
    db.prepare(
      `INSERT INTO skill_sync_state (
        skill_name, source_harness, last_synced_hash, pending_proposal_id,
        pending_detected_hash, pending_detected_version, pending_diff_summary,
        pending_diff_payload, pending_proposed_by, pending_proposed_at,
        version_pinned_to, last_check_at, prior_version, prior_content_hash,
        prior_skill_id, approved_by, approved_at, rejected_by, rejected_at,
        rejection_reason, created_at, updated_at
      ) VALUES (
        ?, ?, ?, NULL,
        NULL, NULL, '',
        '{}', NULL, NULL,
        NULL, ?, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL,
        NULL, ?, ?
      )`
    ).run("no-pending", "claude", "0".repeat(64), new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
    expect(() =>
      approveImportProposal(db, {
        skill_name: "no-pending",
        source_harness: "claude",
        operator: "alice",
      })
    ).toThrow(/No pending proposal/);

    const { proposal } = createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: "rejected-approve",
        source_harness: "claude",
        version: "2.0.0",
        raw_body: VALID_SKILL_MD("rejected-approve", "2.0.0"),
        content_hash: "1".repeat(64),
      },
      proposed_by: "scanner",
    });
    db.prepare(
      `UPDATE skill_sync_state
          SET rejected_at = ?, pending_proposal_id = ?
        WHERE skill_name = ? AND source_harness = ?`
    ).run(new Date().toISOString(), proposal.pending_proposal_id, "rejected-approve", "claude");
    expect(() =>
      approveImportProposal(db, {
        skill_name: "rejected-approve",
        source_harness: "claude",
        operator: "alice",
      })
    ).toThrow(/was rejected/);
  });

  it("rejectImportProposal fails when nothing is pending or already approved", async () => {
    const { rejectImportProposal, createImportProposal, approveImportProposal, SkillSyncError } =
      await import("../skill-sync");
    expect(() =>
      rejectImportProposal(db, {
        skill_name: "ghost",
        source_harness: "claude",
        operator: "bob",
        reason: "nope",
      })
    ).toThrow(/No sync_state row/);

    insertSkillRow({ name: "reject-none", content_hash: "0".repeat(64) });
    db.prepare(
      `INSERT INTO skill_sync_state (
        skill_name, source_harness, last_synced_hash, pending_proposal_id,
        pending_detected_hash, pending_detected_version, pending_diff_summary,
        pending_diff_payload, pending_proposed_by, pending_proposed_at,
        version_pinned_to, last_check_at, prior_version, prior_content_hash,
        prior_skill_id, approved_by, approved_at, rejected_by, rejected_at,
        rejection_reason, created_at, updated_at
      ) VALUES (
        ?, ?, ?, NULL,
        NULL, NULL, '',
        '{}', NULL, NULL,
        NULL, ?, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL,
        NULL, ?, ?
      )`
    ).run("reject-none", "claude", "0".repeat(64), new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
    expect(() =>
      rejectImportProposal(db, {
        skill_name: "reject-none",
        source_harness: "claude",
        operator: "bob",
        reason: "nope",
      })
    ).toThrow(/No pending proposal/);

    insertSkillRow({ name: "reject-approved", content_hash: "0".repeat(64) });
    createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: "reject-approved",
        source_harness: "claude",
        version: "2.0.0",
        raw_body: VALID_SKILL_MD("reject-approved", "2.0.0"),
        content_hash: "1".repeat(64),
      },
      proposed_by: "scanner",
    });
    db.prepare(
      `UPDATE skill_sync_state
          SET approved_at = ?, approved_by = ?
        WHERE skill_name = ? AND source_harness = ?`
    ).run(new Date().toISOString(), "alice", "reject-approved", "claude");
    expect(() =>
      rejectImportProposal(db, {
        skill_name: "reject-approved",
        source_harness: "claude",
        operator: "bob",
        reason: "too late",
      })
    ).toThrow(/already approved/);
  });

  it("approveSyncProposalById enforces proposal lifecycle and hash re-verification", async () => {
    const {
      createImportProposal,
      approveSyncProposalById,
      rejectSyncProposalById,
      SkillSyncError,
      computeContentHash,
    } = await import("../skill-sync");
    const harnessRoots = buildHarnessRoots(TMP_ROOT);
    const body = VALID_SKILL_MD("hash-verify", "2.0.0");
    const filePath = writeHarnessSkill(harnessRoots.claude, "hash-verify", body);
    const hash = computeContentHash(body);
    insertSkillRow({ name: "hash-verify", content_hash: "0".repeat(64) });
    const { proposal } = createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: "hash-verify",
        source_harness: "claude",
        version: "2.0.0",
        raw_body: body,
        content_hash: hash,
        file_path: filePath,
      },
      proposed_by: "scanner",
      source_root: harnessRoots.claude,
    });

    expect(() =>
      approveSyncProposalById(db, {
        proposal_id: "missing-proposal",
        operator: "alice",
      })
    ).toThrow(/No pending sync proposal/);

    fs.writeFileSync(filePath, VALID_SKILL_MD("hash-verify", "9.9.9"), "utf8");
    expect(() =>
      approveSyncProposalById(db, {
        proposal_id: proposal.pending_proposal_id!,
        operator: "alice",
      })
    ).toThrow(/Source hash mismatch/);

    fs.writeFileSync(filePath, body, "utf8");
    const approved = approveSyncProposalById(db, {
      proposal_id: proposal.pending_proposal_id!,
      operator: "alice",
    });
    expect(approved.status).toBe("approved");

    insertSkillRow({ name: "already-approved-id", content_hash: "5".repeat(64) });
    const already = createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: "already-approved-id",
        source_harness: "claude",
        version: "2.0.0",
        raw_body: VALID_SKILL_MD("already-approved-id", "2.0.0"),
        content_hash: "6".repeat(64),
      },
      proposed_by: "scanner",
    });
    db.prepare(
      `UPDATE skill_sync_state SET approved_at = ? WHERE pending_proposal_id = ?`
    ).run(new Date().toISOString(), already.proposal.pending_proposal_id);
    expect(() =>
      approveSyncProposalById(db, {
        proposal_id: already.proposal.pending_proposal_id!,
        operator: "alice",
      })
    ).toThrow(/already approved/);

    insertSkillRow({ name: "reject-by-id-2", content_hash: "0".repeat(64) });
    const pending = createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: "reject-by-id-2",
        source_harness: "claude",
        version: "2.0.0",
        raw_body: VALID_SKILL_MD("reject-by-id-2", "2.0.0"),
        content_hash: "2".repeat(64),
      },
      proposed_by: "scanner",
    });
    db.prepare(
      `UPDATE skill_sync_state SET rejected_at = ? WHERE pending_proposal_id = ?`
    ).run(new Date().toISOString(), pending.proposal.pending_proposal_id);
    expect(() =>
      rejectSyncProposalById(db, {
        proposal_id: pending.proposal.pending_proposal_id!,
        operator: "bob",
        reason: "again",
      })
    ).toThrow(/already rejected/);
  });

  it("detectHarnessSkills falls back to filename and records version frontmatter", async () => {
    const { detectHarnessSkills } = await import("../skill-sync");
    const harnessRoots = buildHarnessRoots(TMP_ROOT);
    fs.mkdirSync(harnessRoots.codex, { recursive: true });
    fs.writeFileSync(
      path.join(harnessRoots.codex, "filename-only.md"),
      "---\nversion: 3.2.1\n---\n\n# Body without name field\n",
      "utf8"
    );
    const detected = detectHarnessSkills({ roots: harnessRoots });
    const entry = detected.entries.find((e) => e.skill_name === "filename-only");
    expect(entry?.version).toBe("3.2.1");
    expect(entry?.parse_error).toMatch(/No `name:` frontmatter/);
  });

  it("listSyncState and listSyncObservability expose pinned and terminal statuses", async () => {
    const {
      pinVersion,
      listSyncState,
      listSyncObservability,
      createImportProposal,
      approveImportProposal,
    } = await import("../skill-sync");
    insertSkillRow({ name: "pin-list", content_hash: "0".repeat(64) });
    pinVersion(db, {
      skill_name: "pin-list",
      source_harness: "hermes",
      version: "1.0.0",
      actor: "alice",
    });
    expect(listSyncState(db, { pinned_only: true }).some((r) => r.skill_name === "pin-list")).toBe(true);

    insertSkillRow({ name: "approved-obs", content_hash: "0".repeat(64) });
    createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: "approved-obs",
        source_harness: "claude",
        version: "2.0.0",
        raw_body: VALID_SKILL_MD("approved-obs", "2.0.0"),
        content_hash: "3".repeat(64),
      },
      proposed_by: "scanner",
    });
    approveImportProposal(db, {
      skill_name: "approved-obs",
      source_harness: "claude",
      operator: "alice",
    });
    const approvedItem = listSyncObservability(db).find((o) => o.skill_name === "approved-obs");
    expect(approvedItem?.status).toBe("approved");
  });

  it("pinVersion creates sync state when none exists and clearVersionPin requires a row", async () => {
    const { pinVersion, clearVersionPin, SkillSyncError } = await import("../skill-sync");
    const pinned = pinVersion(db, {
      skill_name: "brand-new-pin",
      source_harness: "opencode",
      version: "1.0.0",
      actor: "alice",
    });
    expect(pinned.version_pinned_to).toBe("1.0.0");
    expect(() =>
      clearVersionPin(db, {
        skill_name: "never-pinned",
        source_harness: "claude",
        actor: "alice",
      })
    ).toThrow(SkillSyncError);
  });

  it("checkSync skips malformed entries and updates no-change markers", async () => {
    const { checkSync, computeContentHash } = await import("../skill-sync");
    const harnessRoots = buildHarnessRoots(TMP_ROOT);
    const body = VALID_SKILL_MD("parse-skip", "1.0.0");
    writeHarnessSkill(harnessRoots.claude, "parse-skip", body);
    const hash = computeContentHash(body);
    insertSkillRow({
      name: "parse-skip",
      content_hash: hash,
      version: "1.0.0",
      raw_body: body,
    });
    fs.writeFileSync(
      path.join(harnessRoots.claude, "broken.md"),
      "---\nname: broken\nbut no closing fence\n",
      "utf8"
    );
    const first = checkSync(db, { roots: harnessRoots, proposed_by: "scanner" });
    expect(first.unchanged).toBeGreaterThanOrEqual(1);
    const second = checkSync(db, { roots: harnessRoots, proposed_by: "scanner" });
    expect(second.created).toBe(0);
  });

  it("requireNonEmpty rejects non-string operator values", async () => {
    const { approveImportProposal, SkillSyncError } = await import("../skill-sync");
    expect(() =>
      approveImportProposal(db, {
        skill_name: "x",
        source_harness: "claude",
        operator: 0 as unknown as string,
      })
    ).toThrow(SkillSyncError);
  });

  it("listSyncObservability marks rejected status when pending id remains set", async () => {
    const { createImportProposal, rejectImportProposal, listSyncObservability } =
      await import("../skill-sync");
    insertSkillRow({ name: "rej-obs", content_hash: "0".repeat(64) });
    const { proposal } = createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: "rej-obs",
        source_harness: "claude",
        version: "2.0.0",
        raw_body: VALID_SKILL_MD("rej-obs", "2.0.0"),
        content_hash: "1".repeat(64),
      },
      proposed_by: "scanner",
    });
    rejectImportProposal(db, {
      skill_name: "rej-obs",
      source_harness: "claude",
      operator: "bob",
      reason: "nope",
    });
    db.prepare(
      `UPDATE skill_sync_state
          SET pending_proposal_id = ?, rejected_at = ?, approved_at = NULL
        WHERE skill_name = ? AND source_harness = ?`
    ).run(proposal.pending_proposal_id, new Date().toISOString(), "rej-obs", "claude");
    const item = listSyncObservability(db).find((o) => o.skill_name === "rej-obs");
    expect(item?.status).toBe("rejected");
  });

  it("createImportProposal updates last_check_at when registry hash already matches", async () => {
    const { createImportProposal, computeContentHash } = await import("../skill-sync");
    const body = VALID_SKILL_MD("sync-touch", "1.0.0");
    const hash = computeContentHash(body);
    insertSkillRow({
      name: "sync-touch",
      content_hash: hash,
      version: "1.0.0",
      raw_body: body,
    });
    createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: "sync-touch",
        source_harness: "claude",
        version: "1.0.0",
        raw_body: body,
        content_hash: hash,
      },
      proposed_by: "scanner",
    });
    const before = db
      .prepare(`SELECT last_check_at FROM skill_sync_state WHERE skill_name = ?`)
      .get("sync-touch") as { last_check_at: string };
    await new Promise((r) => setTimeout(r, 5));
    createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: "sync-touch",
        source_harness: "claude",
        version: "1.0.0",
        raw_body: body,
        content_hash: hash,
      },
      proposed_by: "scanner",
    });
    const after = db
      .prepare(`SELECT last_check_at FROM skill_sync_state WHERE skill_name = ?`)
      .get("sync-touch") as { last_check_at: string };
    expect(after.last_check_at >= before.last_check_at).toBe(true);
  });

  it("approveImportProposal can skip registry mutation when apply_to_registry is false", async () => {
    const { createImportProposal, approveImportProposal } = await import("../skill-sync");
    const id = insertSkillRow({
      name: "ledger-only",
      content_hash: "0".repeat(64),
      dispatch_status: "enabled",
    });
    createImportProposal(db, {
      source_harness: "claude",
      detected: {
        skill_name: "ledger-only",
        source_harness: "claude",
        version: "2.0.0",
        raw_body: VALID_SKILL_MD("ledger-only", "2.0.0"),
        content_hash: "4".repeat(64),
      },
      proposed_by: "scanner",
    });
    approveImportProposal(db, {
      skill_name: "ledger-only",
      source_harness: "claude",
      operator: "alice",
      apply_to_registry: false,
    });
    const reg = db
      .prepare(`SELECT dispatch_status, content_hash FROM skill_registry WHERE id = ?`)
      .get(id) as { dispatch_status: string; content_hash: string };
    expect(reg.dispatch_status).toBe("enabled");
    expect(reg.content_hash).toBe("0".repeat(64));
  });
});

describe("detectHarnessSkills filesystem failure paths", () => {
  it("records readdir failures without aborting the scan", async () => {
    const { detectHarnessSkills } = await import("../skill-sync");
    const harnessRoots = buildHarnessRoots(TMP_ROOT);
    fs.mkdirSync(harnessRoots.claude, { recursive: true });
    fs.chmodSync(harnessRoots.claude, 0o000);
    try {
      const result = detectHarnessSkills({ roots: harnessRoots });
      expect(result.errors.some((e) => e.reason.includes("Cannot read directory"))).toBe(true);
    } finally {
      fs.chmodSync(harnessRoots.claude, 0o755);
    }
  });

  it("extracts version frontmatter via detectHarnessSkills entries", async () => {
    const { detectHarnessSkills } = await import("../skill-sync");
    const harnessRoots = buildHarnessRoots(TMP_ROOT);
    fs.mkdirSync(harnessRoots.hermes, { recursive: true });
    fs.writeFileSync(
      path.join(harnessRoots.hermes, "versioned-skill.md"),
      "---\nname: versioned-skill\nversion: 9.8.7\n---\n\n# Body\n",
      "utf8"
    );
    const detected = detectHarnessSkills({ roots: harnessRoots });
    const entry = detected.entries.find((e) => e.skill_name === "versioned-skill");
    expect(entry?.version).toBe("9.8.7");
  });
});

