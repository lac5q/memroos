// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { computeContentHash } from "@/lib/skills/registry";
import { detectHarnessSkills, pinVersion } from "../skill-sync";

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

describe("skill-sync batch21 — audit master probe failure", () => {
  it("detectHarnessSkills records filename fallback parse_error when frontmatter omits name", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-b21-${crypto.randomUUID()}-`));
    tmpRoots.push(root);
    const harness = path.join(root, "codex");
    fs.mkdirSync(harness, { recursive: true });
    fs.writeFileSync(
      path.join(harness, "filename-only-skill.md"),
      `---
version: 1.0.0
---
# No name field
`,
      "utf8",
    );

    const scan = detectHarnessSkills({ roots: { codex: harness } });
    expect(
      scan.entries.some((entry) =>
        entry.parse_error?.includes("No `name:` frontmatter field; using filename as fallback"),
      ),
    ).toBe(true);
  });

  it("pinVersion returns when audit insert fails and sqlite_master probe also throws", () => {
    const database = freshDb();
    const skillName = `audit-master-${crypto.randomUUID().slice(0, 8)}`;
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
        throw new Error("audit insert boom");
      }
      if (sql.includes("sqlite_master") && sql.includes("audit_entries")) {
        throw new Error("master probe boom");
      }
      return originalPrepare(sql);
    }) as typeof database.prepare);

    expect(() =>
      pinVersion(database, {
        skill_name: skillName,
        source_harness: "codex",
        version: "1.0.0",
        actor: "batch21",
      }),
    ).not.toThrow();
  });
});
