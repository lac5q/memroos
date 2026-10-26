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

describe("skill-sync batch19 — scan read guards and approve read failures", () => {
  it("detectHarnessSkills records invalid UTF-8, unreadable files, and filename fallbacks", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-b19-${crypto.randomUUID()}-`));
    tmpRoots.push(root);
    const harness = path.join(root, "codex");
    fs.mkdirSync(harness, { recursive: true });
    fs.writeFileSync(
      path.join(harness, "binary-skill.md"),
      Buffer.from([0xff, 0xfe, 0xfd, 0xfc, 0xfb, 0xfa, 0xf9, 0xf8, 0xf7, 0xf6, 0xf5, 0xf4]),
    );
    fs.writeFileSync(path.join(harness, "filename-only.md"), "# No frontmatter here\n", "utf8");

    const { detectHarnessSkills } = await import("../skill-sync");
    const scan = detectHarnessSkills({ roots: { codex: harness } as Record<string, string> });
    expect(scan.errors.some((e) => /not valid UTF-8/i.test(e.reason))).toBe(true);
    const filenameOnly = scan.entries.find((e) => e.skill_name === "filename-only");
    expect(filenameOnly?.parse_error).toMatch(/frontmatter/i);
  });

  it("approveSyncProposalById succeeds when re-read path escapes harness root", async () => {
    const database = freshDb();
    const { createImportProposal, approveSyncProposalById } = await import("../skill-sync");
    const skillName = `escape-read-${crypto.randomUUID().slice(0, 8)}`;
    const body = `---
name: ${skillName}
version: 2.0.0
---
# Body
`;
    const hash = computeContentHash(body);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-b19-appr-${crypto.randomUUID()}-`));
    tmpRoots.push(root);
    const harnessRoot = path.join(root, "harness");
    fs.mkdirSync(harnessRoot, { recursive: true });
    const skillFile = path.join(harnessRoot, `${skillName}.md`);
    fs.writeFileSync(skillFile, body, "utf8");
    const outside = path.join(root, "outside.md");
    fs.writeFileSync(outside, body, "utf8");

    database
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level)
         VALUES (?, '', 'ops', 'claude', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
      )
      .run(
        skillName,
        body.replace("2.0.0", "1.0.0"),
        new Date().toISOString(),
        computeContentHash(body.replace("2.0.0", "1.0.0")),
      );

    const proposal = createImportProposal(database, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "2.0.0",
        raw_body: body,
        content_hash: hash,
        file_path: skillFile,
      },
      proposed_by: "batch19",
      source_root: harnessRoot,
    });
    database.prepare(`UPDATE skill_sync_state SET pending_diff_payload = ? WHERE pending_proposal_id = ?`).run(
      JSON.stringify({
        source_file_path: outside,
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
});
