// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { computeContentHash } from "@/lib/skills/registry";
import { createImportProposal, detectHarnessSkills, pinVersion } from "../skill-sync";

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
  vi.restoreAllMocks();
});

describe("skill-sync batch17 — audit fallbacks and source file guards", () => {
  it("pinVersion writes skill audit entries when audit_entries exists", () => {
    const database = freshDb();
    pinVersion(database, {
      skill_name: `pinned-${crypto.randomUUID().slice(0, 8)}`,
      source_harness: "claude",
      version: "3.0.0",
      actor: "operator",
    });
    const count = database.prepare(`SELECT COUNT(*) AS count FROM audit_entries`).get() as { count: number };
    expect(count.count).toBeGreaterThanOrEqual(1);
  });

  it("createImportProposal falls back to {} when diff payload serialization throws", () => {
    const database = freshDb();
    const skillName = `json-fail-${crypto.randomUUID().slice(0, 8)}`;
    const body = `---\nname: ${skillName}\nversion: 1.0.0\n---\n# Body`;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-b17-${crypto.randomUUID()}-`));
    tmpRoots.push(root);
    const harnessRoot = path.join(root, "claude-skills");
    fs.mkdirSync(harnessRoot, { recursive: true });
    const filePath = path.join(harnessRoot, `${skillName}.md`);
    fs.writeFileSync(filePath, body, "utf8");
    const stringifySpy = vi.spyOn(JSON, "stringify").mockImplementation((value) => {
      if (value && typeof value === "object" && "source_file_path" in (value as object)) {
        throw new TypeError("Converting circular structure to JSON");
      }
      return JSON.stringify(value);
    });
    const proposal = createImportProposal(database, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "1.0.0",
        raw_body: body,
        content_hash: computeContentHash(body),
        file_path: filePath,
      },
      proposed_by: "batch17",
      source_root: harnessRoot,
    });
    stringifySpy.mockRestore();
    expect(proposal.proposal.pending_diff_payload).toBe("{}");
  });

  it("detectHarnessSkills records unreadable files", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-b17-read-${crypto.randomUUID()}-`));
    tmpRoots.push(root);
    const roots = buildHarnessRoots(root);
    fs.mkdirSync(roots.claude, { recursive: true });
    const unreadable = path.join(roots.claude, "unreadable.md");
    fs.writeFileSync(unreadable, "---\nname: unreadable\n---\n", "utf8");
    fs.chmodSync(unreadable, 0o000);
    const scan = detectHarnessSkills({ roots: { claude: roots.claude } as ReturnType<typeof buildHarnessRoots> });
    fs.chmodSync(unreadable, 0o644);
    expect(scan.errors.some((e) => /Cannot read file/i.test(e.reason))).toBe(true);
  });

  it("rejectSyncProposalById completes when skill audit builder fails", async () => {
    vi.resetModules();
    vi.doMock("@/lib/audit/skill-chain", () => ({
      buildSkillAuditEntry: () => {
        throw new Error("audit builder boom");
      },
    }));
    const database = freshDb();
    const { createImportProposal, rejectSyncProposalById } = await import("../skill-sync");
    const skillName = `reject-audit-${crypto.randomUUID().slice(0, 8)}`;
    const body = `---\nname: ${skillName}\nversion: 1.0.0\n---\n# Body`;
    const proposal = createImportProposal(database, {
      source_harness: "claude",
      detected: {
        skill_name: skillName,
        source_harness: "claude",
        version: "1.0.0",
        raw_body: body,
        content_hash: computeContentHash(body),
      },
      proposed_by: "batch17",
    });
    database.exec("DROP TABLE IF EXISTS audit_entries");
    const result = rejectSyncProposalById(database, {
      proposal_id: proposal.proposal.pending_proposal_id!,
      operator: "operator",
      reason: "batch17 reject without audit table",
    });
    expect(result.status).toBe("rejected");
    vi.doUnmock("@/lib/audit/skill-chain");
    vi.resetModules();
  });
});
