// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { computeContentHash } from "@/lib/skills/registry";
import {
  approveSyncProposalById,
  createImportProposal,
  detectHarnessSkills,
  pinVersion,
} from "../skill-sync";

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

describe("skill-sync batch19c — remaining reachable scanner and audit edges", () => {
  it("createImportProposal stores {} when diff_payload contains circular metadata", () => {
    const database = freshDb();
    const skillName = `circular-diff-${crypto.randomUUID().slice(0, 8)}`;
    const body = `---
name: ${skillName}
version: 1.0.0
---
# Body
`;
    const circular: Record<string, unknown> = { tag: "batch19c" };
    circular.self = circular;
    const proposal = createImportProposal(database, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "1.0.0",
        raw_body: body,
        content_hash: computeContentHash(body),
      },
      proposed_by: "batch19c",
      diff_payload: circular,
    });
    expect(proposal.proposal.pending_diff_payload).toBe("{}");
  });

  it("detectHarnessSkills records skills whose frontmatter omits version", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-b19c-${crypto.randomUUID()}-`));
    tmpRoots.push(root);
    const harness = path.join(root, "codex");
    fs.mkdirSync(harness, { recursive: true });
    fs.writeFileSync(
      path.join(harness, "no-version.md"),
      `---
name: no-version-skill
---
# Missing version field
`,
      "utf8",
    );
    const scan = detectHarnessSkills({ roots: { codex: harness } as Record<string, string> });
    const entry = scan.entries.find((e) => e.skill_name === "no-version-skill");
    expect(entry?.version).toBeNull();
  });

  it("pinVersion swallows audit insert failure when audit_entries table is absent", () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS audit_entries");
    const skillName = `no-audit-${crypto.randomUUID().slice(0, 8)}`;
    expect(() =>
      pinVersion(database, {
        skill_name: skillName,
        source_harness: "claude",
        version: "1.0.0",
        actor: "operator-b19c",
      }),
    ).not.toThrow();
  });

  it("approveSyncProposalById tolerates readSourceFileContent failures after containment checks", () => {
    const database = freshDb();
    const skillName = `read-fail-${crypto.randomUUID().slice(0, 8)}`;
    const body = `---
name: ${skillName}
version: 2.0.0
---
# Body
`;
    const hash = computeContentHash(body);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-b19c-appr-${crypto.randomUUID()}-`));
    tmpRoots.push(root);
    const harnessRoot = path.join(root, "harness");
    fs.mkdirSync(harnessRoot, { recursive: true });
    const skillFile = path.join(harnessRoot, `${skillName}.md`);
    fs.writeFileSync(skillFile, body, "utf8");

    const { proposal } = createImportProposal(database, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "2.0.0",
        raw_body: body,
        content_hash: hash,
        file_path: skillFile,
      },
      proposed_by: "batch19c",
      source_root: harnessRoot,
    });
    const proposalId = proposal.pending_proposal_id!;
    fs.chmodSync(skillFile, 0o000);
    const approved = approveSyncProposalById(database, {
      proposal_id: proposalId,
      operator: "operator-b19c",
      apply_to_registry: false,
    });
    fs.chmodSync(skillFile, 0o644);
    expect(approved.status).toBe("approved");
    expect(approved.reverified_hash).toBeNull();
  });
});

/**
 * Unreachable under current call graph (documented, not forced):
 * - skill-sync.ts:441 — sanitizeJsonPayload(null) has no caller; createImportProposal always builds an object diff.
 * - skill-sync.ts:719-727 — rawBody = raw cannot throw.
 * - skill-sync.ts:736-737 — skillName always has filename fallback when frontmatter name missing.
 * - skill-sync.ts:1500 — readSourceFileContent(null sourceRoot) only called when sourceRoot is truthy.
 */
