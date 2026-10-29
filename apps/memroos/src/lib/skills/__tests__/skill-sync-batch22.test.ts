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

describe("skill-sync batch22 — sanitizeJsonPayload, audit outer catch, scanner edges", () => {
  it("createImportProposal stores {} when diff_payload contains BigInt values", async () => {
    const database = freshDb();
    const skillName = `bigint-diff-${crypto.randomUUID().slice(0, 8)}`;
    const body = `---
name: ${skillName}
version: 1.0.0
---
# Body
`;
    database
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level)
         VALUES (?, '', 'ops', 'codex', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
      )
      .run(skillName, body, new Date().toISOString(), computeContentHash(body));

    const { createImportProposal } = await import("../skill-sync");
    const proposal = createImportProposal(database, {
      source_harness: "codex",
      detected: {
        skill_name: skillName,
        source_harness: "codex",
        version: "2.0.0",
        raw_body: body.replace("1.0.0", "2.0.0"),
        content_hash: computeContentHash(body.replace("1.0.0", "2.0.0")),
      },
      proposed_by: "batch22",
      diff_payload: { tag: "batch22", n: BigInt(42) },
    });
    expect(proposal.proposal.pending_diff_payload).toBe("{}");
  });

  it("pinVersion swallows audit failures when sqlite_master probe throws in outer catch", async () => {
    const database = freshDb();
    const skillChainMod = await import("@/lib/audit/skill-chain");
    vi.spyOn(skillChainMod, "buildSkillAuditEntry").mockImplementation(() => {
      throw new Error("chain build failed batch22");
    });

    const skillName = `audit-outer-${crypto.randomUUID().slice(0, 8)}`;
    const body = `---
name: ${skillName}
version: 1.0.0
---
# Body
`;
    database
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level)
         VALUES (?, '', 'ops', 'codex', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
      )
      .run(skillName, body, new Date().toISOString(), computeContentHash(body));

    const originalPrepare = database.prepare.bind(database);
    vi.spyOn(database, "prepare").mockImplementation(((sql: string) => {
      if (sql.includes("INSERT INTO audit_entries")) {
        throw new Error("audit insert failed batch22");
      }
      if (sql.includes("sqlite_master") && sql.includes("audit_entries")) {
        throw new Error("master probe failed batch22");
      }
      return originalPrepare(sql);
    }) as typeof database.prepare);

    const { pinVersion } = await import("../skill-sync");
    expect(() =>
      pinVersion(database, {
        skill_name: skillName,
        source_harness: "codex",
        version: "1.0.0",
        actor: "batch22",
      }),
    ).not.toThrow();
  });

  it("detectHarnessSkills reports parse_error when frontmatter name is whitespace-only", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-b22-${crypto.randomUUID()}-`));
    tmpRoots.push(root);
    const harness = path.join(root, "codex");
    fs.mkdirSync(harness, { recursive: true });
    fs.writeFileSync(
      path.join(harness, "whitespace-name-skill.md"),
      `---
name:
version: 1.0.0
---
# Uses filename fallback
`,
      "utf8",
    );

    const { detectHarnessSkills } = await import("../skill-sync");
    const scan = detectHarnessSkills({ roots: { codex: harness } });
    const entry = scan.entries.find((e) => e.skill_name === "whitespace-name-skill");
    expect(entry?.parse_error).toContain("filename as fallback");
  });
});
