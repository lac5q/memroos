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
  vi.restoreAllMocks();
});

describe("skill-sync batch23b — diffSkills, audit miss, scanner skips", () => {
  it("diffSkills covers add, no_change, and change field summaries", async () => {
    const { diffSkills } = await import("../skill-sync");
    const bodyA = "---\nname: diff-b23b\nversion: 1.0.0\n---\n# A";
    const bodyB = "---\nname: diff-b23b\nversion: 2.0.0\n---\n# B";
    const hashA = computeContentHash(bodyA);
    const hashB = computeContentHash(bodyB);

    const add = diffSkills(null, {
      skill_name: "diff-b23b",
      source_harness: "codex",
      version: "1.0.0",
      raw_body: bodyA,
      content_hash: hashA,
    });
    expect(add.kind).toBe("add");

    const same = diffSkills(
      {
        skill_name: "diff-b23b",
        source_harness: "codex",
        version: "1.0.0",
        raw_body: bodyA,
        content_hash: hashA,
      },
      {
        skill_name: "diff-b23b",
        source_harness: "codex",
        version: "1.0.0",
        raw_body: bodyA,
        content_hash: hashA,
      },
    );
    expect(same.kind).toBe("no_change");

    const change = diffSkills(
      {
        skill_name: "diff-b23b",
        source_harness: "codex",
        version: "1.0.0",
        raw_body: bodyA,
        content_hash: hashA,
      },
      {
        skill_name: "diff-b23b",
        source_harness: "codex",
        version: "2.0.0",
        raw_body: bodyB,
        content_hash: hashB,
      },
    );
    expect(change.kind).toBe("change");
    expect(change.changed_fields.some((f) => f.field === "version")).toBe(true);
    expect(change.summary).toContain("content_hash");
  });

  it("createImportProposal always embeds detected_hash when diff_payload is omitted", async () => {
    const database = freshDb();
    const skillName = `null-diff-b23b-${crypto.randomUUID().slice(0, 8)}`;
    const body = `---
name: ${skillName}
version: 1.0.0
---
# Body
`;
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
      proposed_by: "batch23b",
    });
    expect(proposal.proposal.pending_diff_payload).toContain("detected_hash");
  });

  it("pinVersion swallows audit insert failure when audit_entries table is absent", async () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS audit_entries");
    const skillName = `audit-miss-b23b-${crypto.randomUUID().slice(0, 8)}`;
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
        throw new Error("audit insert failed batch23b");
      }
      return originalPrepare(sql);
    }) as typeof database.prepare);

    const { pinVersion } = await import("../skill-sync");
    expect(() =>
      pinVersion(database, {
        skill_name: skillName,
        source_harness: "codex",
        version: "1.0.0",
        actor: "batch23b",
      }),
    ).not.toThrow();
  });

  it("detectHarnessSkills skips non-markdown files and still scans named .md skills", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-b23b-${crypto.randomUUID()}-`));
    tmpRoots.push(root);
    const harness = path.join(root, "codex");
    fs.mkdirSync(harness, { recursive: true });
    fs.writeFileSync(path.join(harness, "notes.txt"), "not scanned", "utf8");
    fs.writeFileSync(
      path.join(harness, "named-skill.md"),
      `---
name: named-skill-b23b
version: 1.0.0
---
# Body
`,
      "utf8",
    );

    const { detectHarnessSkills } = await import("../skill-sync");
    const scan = detectHarnessSkills({ roots: { codex: harness } });
    expect(scan.entries.some((e) => e.skill_name === "notes")).toBe(false);
    expect(scan.entries.some((e) => e.skill_name === "named-skill-b23b")).toBe(true);
  });
});
