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

describe("skill-sync batch24 — hash guards, audit swallow, source read edges", () => {
  it("diffSkills rejects invalid detected.content_hash via requireHash", async () => {
    const { diffSkills } = await import("../skill-sync");
    const body = skillMd("hash-guard-b24");
    expect(() =>
      diffSkills(null, {
        skill_name: "hash-guard-b24",
        source_harness: "codex",
        version: "1.0.0",
        raw_body: body,
        content_hash: "short",
      }),
    ).toThrow(/64-char SHA-256 hex/);
  });

  it("rejectSyncProposalById swallows audit failure when sqlite_master probe throws (skill audit inner catch)", async () => {
    const database = freshDb();
    const { createImportProposal, rejectSyncProposalById } = await import("../skill-sync");
    const skillName = `audit-probe-b24-${crypto.randomUUID().slice(0, 8)}`;
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
      },
      proposed_by: "batch24",
    });

    const originalPrepare = database.prepare.bind(database);
    vi.spyOn(database, "prepare").mockImplementation(((sql: string) => {
      if (sql.includes("INSERT INTO audit_entries")) {
        throw new Error("audit insert failed batch24");
      }
      if (sql.includes("sqlite_master") && sql.includes("audit_entries")) {
        throw new Error("master probe failed batch24");
      }
      return originalPrepare(sql);
    }) as typeof database.prepare);

    const rejected = rejectSyncProposalById(database, {
      proposal_id: proposal.proposal.pending_proposal_id!,
      operator: "operator",
      reason: "batch24 probe throw",
    });
    expect(rejected.status).toBe("rejected");
  });

  it("approveSyncProposalById skips re-read for file outside harness root", async () => {
    const database = freshDb();
    const { createImportProposal, approveSyncProposalById } = await import("../skill-sync");
    const skillName = `outside-root-b24-${crypto.randomUUID().slice(0, 8)}`;
    const body = skillMd(skillName, "2.0.0");
    const hash = computeContentHash(body);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-b24-${crypto.randomUUID()}-`));
    tmpRoots.push(root);
    const harnessRoot = path.join(root, "harness");
    fs.mkdirSync(harnessRoot, { recursive: true });
    const outsideDir = path.join(root, "outside");
    fs.mkdirSync(outsideDir, { recursive: true });
    const outsideFile = path.join(outsideDir, `${skillName}.md`);
    fs.writeFileSync(outsideFile, body, "utf8");

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
        file_path: outsideFile,
      },
      proposed_by: "batch24",
      source_root: harnessRoot,
    });
    database.prepare(`UPDATE skill_sync_state SET pending_diff_payload = ? WHERE pending_proposal_id = ?`).run(
      JSON.stringify({
        source_file_path: outsideFile,
        source_root: harnessRoot,
        version: "2.0.0",
      }),
      proposal.proposal.pending_proposal_id!,
    );

    const approved = approveSyncProposalById(database, {
      proposal_id: proposal.proposal.pending_proposal_id!,
      operator: "operator",
    });
    expect(approved.status).toBe("approved");
  });

  it("createImportProposal stores {} when diff_payload contains a circular reference", async () => {
    const database = freshDb();
    const skillName = `circular-b24-${crypto.randomUUID().slice(0, 8)}`;
    const body = skillMd(skillName);
    const circular: Record<string, unknown> = { tag: "batch24" };
    circular.self = circular;
    const { createImportProposal } = await import("../skill-sync");
    const proposal = createImportProposal(database, {
      source_harness: "codex",
      detected: {
        skill_name: skillName,
        source_harness: "codex",
        version: "1.0.0",
        raw_body: body,
        content_hash: computeContentHash(body),
      },
      proposed_by: "batch24",
      diff_payload: circular,
    });
    expect(proposal.proposal.pending_diff_payload).toBe("{}");
  });
});
