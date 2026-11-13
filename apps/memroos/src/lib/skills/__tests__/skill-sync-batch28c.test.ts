// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { computeContentHash } from "@/lib/skills/registry";

const tmpRoots: string[] = [];
let db: Database.Database | null = null;

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
});

describe("skill-sync batch28c — scanner parse warnings and proposal audit", () => {
  it("detectHarnessSkills flags missing name frontmatter while keeping filename fallback (lines 736-743)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-b28c-parse-${crypto.randomUUID()}-`));
    tmpRoots.push(root);
    const harness = path.join(root, "codex");
    fs.mkdirSync(harness, { recursive: true });
    const skillFile = `fallback-only-b28c-${crypto.randomUUID().slice(0, 6)}.md`;
    fs.writeFileSync(path.join(harness, skillFile), "# no frontmatter batch28c\n", "utf8");

    const { detectHarnessSkills } = await import("../skill-sync");
    const scan = detectHarnessSkills({ roots: { codex: harness } });
    const entry = scan.entries.find((e) => e.skill_name.includes("fallback-only-b28c"));
    expect(entry?.parse_error).toMatch(/frontmatter|fallback/i);
  });

  it("createImportProposal persists drift proposals for brand-new skills (lines 1186-1211)", async () => {
    const database = freshDb();
    const skillName = `new-import-b28c-${crypto.randomUUID().slice(0, 6)}`;
    const body = `---\nname: ${skillName}\nversion: 0.2.0\n---\n# batch28c\n`;
    const { createImportProposal } = await import("../skill-sync");
    const result = createImportProposal(database, {
      source_harness: "hermes",
      source_root: "/tmp/unused-b28c",
      proposed_by: "operator-28c",
      detected: {
        skill_name: skillName,
        raw_body: body,
        file_path: `/tmp/${skillName}.md`,
      },
      diff_summary: "new skill batch28c",
    });
    expect(result.created).toBe(true);
    expect(result.proposal.pending_proposal_id).toBeTruthy();
    expect(result.proposal.pending_diff_payload).toContain("source_file_path");
  });

  it("rejectSyncProposalById writes audit metadata for pending proposals", async () => {
    const database = freshDb();
    const skillName = `reject-b28c-${crypto.randomUUID().slice(0, 6)}`;
    const body = `---\nname: ${skillName}\nversion: 1.0.0\n---\n# reject\n`;
    const hash = computeContentHash(body);
    database
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level)
         VALUES (?, '', 'ops', 'codex', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
      )
      .run(skillName, body, new Date().toISOString(), hash);

    const { createImportProposal, rejectSyncProposalById } = await import("../skill-sync");
    const driftBody = body.replace("1.0.0", "1.0.1");
    const { proposal } = createImportProposal(database, {
      source_harness: "codex",
      source_root: "/tmp/b28c",
      proposed_by: "operator-28c",
      detected: { skill_name: skillName, raw_body: driftBody },
    });
    const proposalId = proposal.pending_proposal_id!;
    rejectSyncProposalById(database, {
      proposal_id: proposalId,
      operator: "operator-28c",
      reason: "batch28c reject",
    });
    const row = database
      .prepare(`SELECT rejected_by, rejection_reason FROM skill_sync_state WHERE skill_name = ? AND source_harness = ?`)
      .get(skillName, "codex") as { rejected_by: string; rejection_reason: string };
    expect(row.rejected_by).toBe("operator-28c");
    expect(row.rejection_reason).toBe("batch28c reject");
  });
});
