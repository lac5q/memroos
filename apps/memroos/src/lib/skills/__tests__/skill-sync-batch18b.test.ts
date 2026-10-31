// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { computeContentHash } from "@/lib/skills/registry";
import { SkillSyncError } from "../skill-sync";

const VALID_SKILL_MD = (skillName: string) => `---
name: ${skillName}
version: 1.0.0
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
  vi.restoreAllMocks();
  vi.doUnmock("@/lib/audit/skill-chain");
  vi.resetModules();
});

describe("skill-sync batch18b — sanitizeJson, audit throw, read guards, requireSkillName", () => {
  it("createImportProposal rejects empty skill_name via requireSkillName", async () => {
    const database = freshDb();
    const { createImportProposal } = await import("../skill-sync");
    const body = VALID_SKILL_MD("ignored");
    expect(() =>
      createImportProposal(database, {
        source_harness: "claude",
        detected: {
          skill_name: "   ",
          source_harness: "claude",
          version: "1.0.0",
          raw_body: body,
          content_hash: computeContentHash(body),
        },
        proposed_by: "batch18b",
      }),
    ).toThrow(SkillSyncError);
  });

  it("createImportProposal stores {} diff payload when JSON.stringify throws on circular metadata", async () => {
    const database = freshDb();
    const { createImportProposal } = await import("../skill-sync");
    const skillName = `circular-${crypto.randomUUID().slice(0, 8)}`;
    const body = VALID_SKILL_MD(skillName);
    const circular: Record<string, unknown> = { note: "batch18b" };
    circular.self = circular;
    const proposal = createImportProposal(database, {
      source_harness: "codex",
      detected: {
        skill_name: skillName,
        source_harness: "codex",
        version: "1.0.0",
        raw_body: body,
        content_hash: computeContentHash(body),
      },
      proposed_by: "batch18b",
      diff_payload: circular,
    });
    expect(proposal.proposal.pending_diff_payload).toBe("{}");
  });

  it("pinVersion rethrows audit insert failure when audit_entries table exists", async () => {
    vi.doMock("@/lib/audit/skill-chain", () => ({
      buildSkillAuditEntry: () => {
        throw new Error("audit builder boom");
      },
    }));
    const database = freshDb();
    const { pinVersion } = await import("../skill-sync");
    const skillName = `audit-throw-${crypto.randomUUID().slice(0, 8)}`;
    const originalPrepare = database.prepare.bind(database);
    vi.spyOn(database, "prepare").mockImplementation((sql: string) => {
      if (sql.includes("INSERT INTO audit_entries")) {
        throw new Error("forced audit insert failure");
      }
      return originalPrepare(sql);
    });
    expect(() =>
      pinVersion(database, {
        skill_name: skillName,
        source_harness: "claude",
        version: "1.0.0",
        actor: "operator",
      }),
    ).toThrow(/forced audit insert failure/);
  });

  it("createImportProposal rejects malformed detected.content_hash values", async () => {
    const database = freshDb();
    const { createImportProposal } = await import("../skill-sync");
    const skillName = `bad-hash-${crypto.randomUUID().slice(0, 8)}`;
    const body = VALID_SKILL_MD(skillName);
    expect(() =>
      createImportProposal(database, {
        source_harness: "claude",
        detected: {
          skill_name: skillName,
          source_harness: "claude",
          version: "1.0.0",
          raw_body: body,
          content_hash: "not-a-sha256",
        },
        proposed_by: "batch18b",
      }),
    ).toThrow(/64-char SHA-256 hex/);
  });

  it("detectHarnessSkills refuses harness roots that are symlinks", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-b18b-root-${crypto.randomUUID()}-`));
    tmpRoots.push(root);
    const realHarness = path.join(root, "real-harness");
    fs.mkdirSync(realHarness, { recursive: true });
    fs.writeFileSync(path.join(realHarness, "linked-skill.md"), VALID_SKILL_MD("linked-skill"), "utf8");
    const symlinkRoot = path.join(root, "symlink-harness");
    fs.symlinkSync(realHarness, symlinkRoot);
    const { detectHarnessSkills } = await import("../skill-sync");
    const scan = detectHarnessSkills({
      roots: { claude: symlinkRoot } as Record<string, string>,
    });
    expect(scan.errors.some((e) => /symlink/i.test(e.reason))).toBe(true);
  });
});
