// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { computeContentHash } from "@/lib/skills/registry";
import {
  SkillSyncError,
  checkSync,
  clearVersionPin,
  diffSkills,
  pinVersion,
  requireHarness,
} from "../skill-sync";

function buildHarnessRoots(root: string) {
  return {
    claude: path.join(root, "claude"),
    codex: path.join(root, "codex"),
    hermes: path.join(root, "hermes"),
    opencode: path.join(root, "opencode"),
  };
}

let db: Database.Database | null = null;
const tmpRoots: string[] = [];

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

afterEach(() => {
  db?.close();
  db = null;
  for (const root of tmpRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  tmpRoots.length = 0;
});

describe("skill-sync batch16c — validation and checkSync parse_error skip", () => {
  it("requireHarness rejects whitespace-only harness names", () => {
    expect(() => requireHarness("   ")).toThrow(SkillSyncError);
    expect(() => requireHarness("")).toThrow(/source_harness/);
  });

  it("diffSkills rejects malformed content_hash", () => {
    expect(() =>
      diffSkills(null, {
        skill_name: "demo",
        source_harness: "claude",
        content_hash: "not-a-hash",
      }),
    ).toThrow(/64-char SHA-256/);
  });

  it("checkSync skips entries with parse_error and counts unchanged registry rows", () => {
    const database = freshDb();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-b16c-${crypto.randomUUID()}-`));
    tmpRoots.push(root);
    const roots = buildHarnessRoots(root);
    fs.mkdirSync(roots.claude, { recursive: true });
    const body = "---\nname: synced-skill\nversion: 1\n---\n# Synced";
    fs.writeFileSync(path.join(roots.claude, "synced-skill.md"), body, "utf8");
    fs.writeFileSync(path.join(roots.claude, "no-frontmatter.md"), "# Body only\n", "utf8");

    const hash = computeContentHash(body);
    database
      .prepare(
        `INSERT INTO skill_registry (
          name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level, signature, lifecycle_state
        ) VALUES (?, '', 'ops', 'claude', 'low', 'enabled', '1', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned', NULL, 'enabled')`,
      )
      .run("synced-skill", body, new Date().toISOString(), hash);

    const summary = checkSync(database, { roots, proposed_by: "batch16c" });
    expect(summary.detected).toBeGreaterThanOrEqual(2);
    expect(summary.errors.some((e) => /frontmatter/i.test(e.reason))).toBe(true);
    expect(summary.created).toBe(0);
    expect(summary.unchanged).toBeGreaterThanOrEqual(1);
  });

  it("clearVersionPin requires an existing pin on sync_state", () => {
    const database = freshDb();
    pinVersion(database, {
      skill_name: "pinned-skill",
      source_harness: "codex",
      version: "2.0.0",
      actor: "operator",
    });
    clearVersionPin(database, {
      skill_name: "pinned-skill",
      source_harness: "codex",
      actor: "operator",
    });
    expect(() =>
      clearVersionPin(database, {
        skill_name: "pinned-skill",
        source_harness: "codex",
        actor: "operator",
      }),
    ).toThrow(/No version pin/);
  });
});
