// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { computeContentHash } from "@/lib/skills/registry";

const tmpRoots: string[] = [];
let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

function skillMd(name: string, version = "1.0.0"): string {
  return `---\nname: ${name}\nversion: ${version}\n---\n# Body\n`;
}

afterEach(() => {
  db?.close();
  db = null;
  for (const root of tmpRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  tmpRoots.length = 0;
  const signingKey = path.join(process.cwd(), "data", "skill-signing-key.json");
  if (fs.existsSync(signingKey)) fs.unlinkSync(signingKey);
  vi.restoreAllMocks();
});

describe("skill-sync batch26 — audit outer catch, scanner edges, diff and sync paths", () => {
  it("pinVersion returns when audit insert fails and audit_entries table is absent (outer catch line 566)", async () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS audit_entries");
    const skillChainMod = await import("@/lib/audit/skill-chain");
    vi.spyOn(skillChainMod, "buildSkillAuditEntry").mockImplementation(() => {
      throw new Error("chain build failed batch26");
    });

    const skillName = `audit-miss-table-b26-${crypto.randomUUID().slice(0, 8)}`;
    const body = skillMd(skillName);
    database
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level)
         VALUES (?, '', 'ops', 'codex', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
      )
      .run(skillName, body, new Date().toISOString(), computeContentHash(body));

    const { pinVersion } = await import("../skill-sync");
    expect(() =>
      pinVersion(database, {
        skill_name: skillName,
        source_harness: "codex",
        version: "1.0.0",
        actor: "batch26",
      }),
    ).not.toThrow();
  });

  it("rejectSyncProposalById swallows audit failure when sqlite_master probe throws (outer catch line 568)", async () => {
    const database = freshDb();
    const skillName = `audit-probe-b26-${crypto.randomUUID().slice(0, 8)}`;
    const body = skillMd(skillName, "2.0.0");
    const hash = computeContentHash(body);
    database
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level)
         VALUES (?, '', 'ops', 'claude', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
      )
      .run(skillName, skillMd(skillName, "1.0.0"), new Date().toISOString(), computeContentHash(skillMd(skillName, "1.0.0")));

    const { createImportProposal, rejectSyncProposalById } = await import("../skill-sync");
    const proposal = createImportProposal(database, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "2.0.0",
        raw_body: body,
        content_hash: hash,
      },
      proposed_by: "batch26",
    });

    const originalPrepare = database.prepare.bind(database);
    vi.spyOn(database, "prepare").mockImplementation(((sql: string) => {
      if (sql.includes("INSERT INTO audit_entries")) {
        throw new Error("audit insert failed batch26");
      }
      if (sql.includes("sqlite_master") && sql.includes("audit_entries")) {
        throw new Error("master probe failed batch26");
      }
      return originalPrepare(sql);
    }) as typeof database.prepare);

    const rejected = rejectSyncProposalById(database, {
      proposal_id: proposal.proposal.pending_proposal_id!,
      operator: "operator",
      reason: "batch26 probe throw",
    });
    expect(rejected.status).toBe("rejected");
  });

  it("detectHarnessSkills records readdir failures for unreadable harness directories", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-b26-readdir-${crypto.randomUUID()}-`));
    tmpRoots.push(root);
    const harness = path.join(root, "codex");
    fs.mkdirSync(harness, { recursive: true });
    fs.chmodSync(harness, 0o000);

    vi.resetModules();
    const { detectHarnessSkills } = await import("../skill-sync");
    const scan = detectHarnessSkills({ roots: { codex: harness } });
    fs.chmodSync(harness, 0o755);
    expect(scan.errors.some((e) => e.reason.includes("Cannot read directory"))).toBe(true);
    expect(scan.entries).toHaveLength(0);
  });

  it("detectHarnessSkills refuses harness root that is a symlink", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-b26-root-symlink-${crypto.randomUUID()}-`));
    tmpRoots.push(root);
    const realHarness = path.join(root, "real-codex");
    fs.mkdirSync(realHarness, { recursive: true });
    fs.writeFileSync(path.join(realHarness, "linked-skill.md"), skillMd("linked-skill"), "utf8");
    const symlinkHarness = path.join(root, "codex-link");
    fs.symlinkSync(realHarness, symlinkHarness);

    const { detectHarnessSkills } = await import("../skill-sync");
    const scan = detectHarnessSkills({ roots: { codex: symlinkHarness } });
    expect(scan.errors.some((e) => e.reason.includes("harness root is a symlink"))).toBe(true);
    expect(scan.entries).toHaveLength(0);
  });

  it("approveSyncProposalById skips readSourceFileContent when source_root is null (line 1500)", async () => {
    const database = freshDb();
    const { createImportProposal, approveSyncProposalById } = await import("../skill-sync");
    const skillName = `no-source-root-b26-${crypto.randomUUID().slice(0, 8)}`;
    const body = skillMd(skillName, "2.0.0");
    const hash = computeContentHash(body);
    database
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level)
         VALUES (?, '', 'ops', 'claude', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
      )
      .run(skillName, skillMd(skillName, "1.0.0"), new Date().toISOString(), computeContentHash(skillMd(skillName, "1.0.0")));

    const proposal = createImportProposal(database, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "2.0.0",
        raw_body: body,
        content_hash: hash,
        file_path: "/tmp/should-not-read-b26.md",
      },
      proposed_by: "batch26",
      source_root: null,
    });
    database
      .prepare(`UPDATE skill_sync_state SET pending_diff_payload = ? WHERE pending_proposal_id = ?`)
      .run(
        JSON.stringify({
          source_file_path: "/tmp/should-not-read-b26.md",
          source_root: null,
          raw_body: body,
        }),
        proposal.proposal.pending_proposal_id!,
      );

    const approved = approveSyncProposalById(database, {
      proposal_id: proposal.proposal.pending_proposal_id!,
      operator: "operator",
    });
    expect(approved.status).toBe("approved");
  });

  it("createImportProposal dedupes pending proposal with identical detected hash", async () => {
    const database = freshDb();
    const skillName = `dedupe-b26-${crypto.randomUUID().slice(0, 8)}`;
    const body = skillMd(skillName, "2.0.0");
    const hash = computeContentHash(body);
    database
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level)
         VALUES (?, '', 'ops', 'codex', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
      )
      .run(skillName, skillMd(skillName, "1.0.0"), new Date().toISOString(), computeContentHash(skillMd(skillName, "1.0.0")));

    const { createImportProposal } = await import("../skill-sync");
    const first = createImportProposal(database, {
      source_harness: "codex",
      detected: {
        skill_name: skillName,
        source_harness: "codex",
        version: "2.0.0",
        raw_body: body,
        content_hash: hash,
      },
      proposed_by: "batch26",
    });
    expect(first.created).toBe(true);
    const second = createImportProposal(database, {
      source_harness: "codex",
      detected: {
        skill_name: skillName,
        source_harness: "codex",
        version: "2.0.0",
        raw_body: body,
        content_hash: hash,
      },
      proposed_by: "batch26",
    });
    expect(second.created).toBe(false);
    expect(second.proposal.pending_proposal_id).toBe(first.proposal.pending_proposal_id);
  });

  it("diffSkills reports version-only drift and builds non-empty change summary", async () => {
    const { diffSkills } = await import("../skill-sync");
    const name = `version-drift-b26-${crypto.randomUUID().slice(0, 8)}`;
    const body = skillMd(name, "1.0.0");
    const hash = computeContentHash(body);
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
        version: "2.0.0",
        raw_body: body,
        content_hash: "f".repeat(64),
      },
    );
    expect(diff.kind).toBe("change");
    expect(diff.changed_fields.some((f) => f.field === "version")).toBe(true);
    expect(diff.summary.length).toBeGreaterThan(0);
  });

  it("checkSync stashes harness source_root on new proposals", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-b26-check-${crypto.randomUUID()}-`));
    tmpRoots.push(root);
    const harness = path.join(root, "claude");
    fs.mkdirSync(harness, { recursive: true });
    const skillName = `check-sync-b26-${crypto.randomUUID().slice(0, 8)}`;
    fs.writeFileSync(path.join(harness, `${skillName}.md`), skillMd(skillName, "1.0.0"), "utf8");

    const database = freshDb();
    const { checkSync } = await import("../skill-sync");
    const outcome = checkSync(database, {
      roots: { claude: harness },
      proposed_by: "batch26",
    });
    expect(outcome.created).toBe(1);
    const row = database
      .prepare(
        `SELECT pending_diff_payload FROM skill_sync_state WHERE skill_name = ? AND source_harness = 'claude'`,
      )
      .get(skillName) as { pending_diff_payload: string };
    const payload = JSON.parse(row.pending_diff_payload) as { source_root?: string };
    expect(payload.source_root).toBe(harness);
  });
});
