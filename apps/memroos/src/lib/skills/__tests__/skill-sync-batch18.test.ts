// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { computeContentHash } from "@/lib/skills/registry";
import { createImportProposal, detectHarnessSkills, rejectSyncProposalById } from "../skill-sync";

function buildHarnessRoots(root: string) {
  return {
    claude: path.join(root, "claude"),
    codex: path.join(root, "codex"),
    hermes: path.join(root, "hermes"),
    opencode: path.join(root, "opencode"),
  };
}

const VALID_SKILL_MD = (skillName: string, version?: string) => `---
name: ${skillName}
version: ${version ?? ""}
---
# Body
`;

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
  const signingKey = path.join(process.cwd(), "data", "skill-signing-key.json");
  if (fs.existsSync(signingKey)) fs.unlinkSync(signingKey);
  vi.restoreAllMocks();
});

describe("skill-sync batch18 — audit fallbacks, scan edges, source read guards", () => {
  it("pinVersion completes when audit_entries table is missing after skill audit builder fails", async () => {
    vi.resetModules();
    vi.doMock("@/lib/audit/skill-chain", () => ({
      buildSkillAuditEntry: () => {
        throw new Error("audit builder boom");
      },
    }));
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS audit_entries");
    const { pinVersion: pin } = await import("../skill-sync");
    expect(() =>
      pin(database, {
        skill_name: `pin-no-audit-${crypto.randomUUID().slice(0, 8)}`,
        source_harness: "claude",
        version: "1.0.0",
        actor: "operator",
      }),
    ).not.toThrow();
    vi.doUnmock("@/lib/audit/skill-chain");
    vi.resetModules();
  });

  it("detectHarnessSkills records empty version frontmatter and symlink source files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-b18-${crypto.randomUUID()}-`));
    tmpRoots.push(root);
    const roots = buildHarnessRoots(root);
    fs.mkdirSync(roots.codex, { recursive: true });
    const skillName = `empty-version-${crypto.randomUUID().slice(0, 8)}`;
    fs.writeFileSync(path.join(roots.codex, `${skillName}.md`), VALID_SKILL_MD(skillName, ""), "utf8");
    const linkTarget = path.join(roots.codex, "target.md");
    fs.writeFileSync(linkTarget, VALID_SKILL_MD("target-skill", "1.0.0"), "utf8");
    const symlinkPath = path.join(roots.codex, "linked-skill.md");
    fs.symlinkSync(linkTarget, symlinkPath);
    const scan = detectHarnessSkills({ roots: { codex: roots.codex } as ReturnType<typeof buildHarnessRoots> });
    expect(scan.entries.some((e) => e.skill_name === skillName && e.version === null)).toBe(true);
    expect(scan.errors.some((e) => /symlink/i.test(e.reason))).toBe(true);
  });

  it("rejectSyncProposalById survives sqlite_master lookup failure in audit fallback", async () => {
    vi.resetModules();
    vi.doMock("@/lib/audit/skill-chain", () => ({
      buildSkillAuditEntry: () => {
        throw new Error("audit builder boom");
      },
    }));
    const database = freshDb();
    const { createImportProposal, rejectSyncProposalById } = await import("../skill-sync");
    const skillName = `reject-master-${crypto.randomUUID().slice(0, 8)}`;
    const body = VALID_SKILL_MD(skillName, "1.0.0");
    const proposal = createImportProposal(database, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "1.0.0",
        raw_body: body,
        content_hash: computeContentHash(body),
      },
      proposed_by: "batch18",
    });
    const originalPrepare = database.prepare.bind(database);
    vi.spyOn(database, "prepare").mockImplementation((sql: string) => {
      if (sql.includes("sqlite_master")) {
        throw new Error("mock sqlite_master failure");
      }
      return originalPrepare(sql);
    });
    const result = rejectSyncProposalById(database, {
      proposal_id: proposal.proposal.pending_proposal_id!,
      operator: "operator",
      reason: "batch18 reject with broken master lookup",
    });
    expect(result.status).toBe("rejected");
    vi.doUnmock("@/lib/audit/skill-chain");
    vi.resetModules();
  });

  it("approveSyncProposalById returns null read when source file is a symlink", async () => {
    const database = freshDb();
    const { createImportProposal, approveSyncProposalById } = await import("../skill-sync");
    const skillName = `symlink-read-${crypto.randomUUID().slice(0, 8)}`;
    const body = VALID_SKILL_MD(skillName, "2.0.0");
    const hash = computeContentHash(body);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-b18-appr-${crypto.randomUUID()}-`));
    tmpRoots.push(root);
    const harnessRoot = path.join(root, "harness");
    fs.mkdirSync(harnessRoot, { recursive: true });
    const realFile = path.join(harnessRoot, `${skillName}.md`);
    fs.writeFileSync(realFile, body, "utf8");
    const symlinkFile = path.join(harnessRoot, "via-link.md");
    fs.symlinkSync(realFile, symlinkFile);
    database
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level)
         VALUES (?, '', 'ops', 'claude', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
      )
      .run(skillName, VALID_SKILL_MD(skillName, "1.0.0"), new Date().toISOString(), computeContentHash(VALID_SKILL_MD(skillName, "1.0.0")));
    const proposal = createImportProposal(database, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "2.0.0",
        raw_body: body,
        content_hash: hash,
        file_path: symlinkFile,
      },
      proposed_by: "batch18",
      source_root: harnessRoot,
    });
    database.prepare(`UPDATE skill_sync_state SET pending_diff_payload = ? WHERE pending_proposal_id = ?`).run(
      JSON.stringify({
        source_file_path: symlinkFile,
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

  it("createImportProposal stores diff payload when JSON.stringify succeeds for null nested fields", () => {
    const database = freshDb();
    const skillName = `null-nested-${crypto.randomUUID().slice(0, 8)}`;
    const body = VALID_SKILL_MD(skillName, "1.0.0");
    const proposal = createImportProposal(database, {
      source_harness: "hermes",
      detected: {
        skill_name: skillName,
        source_harness: "hermes",
        version: null,
        raw_body: body,
        content_hash: computeContentHash(body),
      },
      proposed_by: "batch18",
      diff_payload: { optional: null },
    });
    expect(proposal.proposal.pending_diff_payload).toContain("detected_hash");
  });
});
