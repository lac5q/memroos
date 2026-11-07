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

describe("skill-sync batch27 — sanitizeJson, audit fallback insert, scanner and diff edges", () => {
  it("createImportProposal uses sanitizeJsonPayload fallback when diff payload is circular (lines 441-445)", async () => {
    const database = freshDb();
    const skillName = `circ-json-b27-${crypto.randomUUID().slice(0, 8)}`;
    const body = skillMd(skillName, "2.0.0");
    const hash = computeContentHash(body);
    database
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level)
         VALUES (?, '', 'ops', 'codex', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
      )
      .run(skillName, skillMd(skillName, "1.0.0"), new Date().toISOString(), computeContentHash(skillMd(skillName, "1.0.0")));

    const circular: Record<string, unknown> = { raw_body: body };
    circular.self = circular;

    const { createImportProposal } = await import("../skill-sync");
    const result = createImportProposal(database, {
      source_harness: "codex",
      detected: {
        skill_name: skillName,
        source_harness: "codex",
        version: "2.0.0",
        raw_body: body,
        content_hash: hash,
      },
      proposed_by: "batch27",
      diff_payload: circular,
    });
    expect(result.created).toBe(true);
    const row = database
      .prepare(`SELECT pending_diff_payload FROM skill_sync_state WHERE skill_name = ?`)
      .get(skillName) as { pending_diff_payload: string };
    expect(row.pending_diff_payload).toBe("{}");
  });

  it("writeAuditEntry falls back to generic insert when skill-chain build fails but audit_entries exists (lines 503-558)", async () => {
    const database = freshDb();
    const skillChainMod = await import("@/lib/audit/skill-chain");
    vi.spyOn(skillChainMod, "buildSkillAuditEntry").mockImplementation(() => {
      throw new Error("chain build failed batch27");
    });

    const skillName = `audit-fallback-b27-${crypto.randomUUID().slice(0, 8)}`;
    const body = skillMd(skillName);
    database
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level)
         VALUES (?, '', 'ops', 'codex', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
      )
      .run(skillName, body, new Date().toISOString(), computeContentHash(body));

    const { pinVersion } = await import("../skill-sync");
    pinVersion(database, {
      skill_name: skillName,
      source_harness: "codex",
      version: "1.0.0",
      actor: "batch27",
    });
    const auditCount = database.prepare(`SELECT COUNT(*) AS c FROM audit_entries`).get() as { c: number };
    expect(auditCount.c).toBeGreaterThanOrEqual(1);
  });

  it("writeAuditEntry rethrows when generic audit insert fails but audit_entries table exists (line 570)", async () => {
    const database = freshDb();
    const skillName = `audit-rethrow-b27-${crypto.randomUUID().slice(0, 8)}`;
    const body = skillMd(skillName);
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
        throw new Error("audit insert hard fail batch27");
      }
      if (sql.includes("sqlite_master") && sql.includes("audit_entries")) {
        return originalPrepare(sql);
      }
      return originalPrepare(sql);
    }) as typeof database.prepare);

    const { pinVersion } = await import("../skill-sync");
    expect(() =>
      pinVersion(database, {
        skill_name: skillName,
        source_harness: "codex",
        version: "1.0.0",
        actor: "batch27",
      }),
    ).toThrow(/audit insert hard fail batch27/);
  });

  it("detectHarnessSkills reports symlink files, escape attempts, and invalid UTF-8 (lines 658-705)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-b27-scan-${crypto.randomUUID()}-`));
    tmpRoots.push(root);
    const harness = path.join(root, "codex");
    fs.mkdirSync(harness, { recursive: true });

    const goodName = `good-b27-${crypto.randomUUID().slice(0, 6)}`;
    fs.writeFileSync(path.join(harness, `${goodName}.md`), skillMd(goodName), "utf8");

    const outside = path.join(root, "outside.md");
    fs.writeFileSync(outside, skillMd("outside-skill"), "utf8");
    try {
      fs.symlinkSync(outside, path.join(harness, "symlink-skill.md"));
    } catch {
      // skip symlink file test on platforms that disallow symlinks
    }

    const escapeDir = path.join(root, "escape");
    fs.mkdirSync(escapeDir, { recursive: true });
    fs.writeFileSync(path.join(escapeDir, "escape-skill.md"), skillMd("escape-skill"), "utf8");
    try {
      fs.symlinkSync(escapeDir, path.join(harness, "escape-link.md"));
    } catch {
      // skip
    }

    const binaryPath = path.join(harness, "binary-skill.md");
    fs.writeFileSync(binaryPath, Buffer.from([0xff, 0xfe, 0x00, 0x00, 0xff, 0xfe, 0x00, 0x00]), undefined);

    const { detectHarnessSkills } = await import("../skill-sync");
    const scan = detectHarnessSkills({ roots: { codex: harness } });
    expect(scan.entries.some((e) => e.skill_name === goodName)).toBe(true);
    expect(scan.errors.some((e) => e.reason.includes("symlink"))).toBe(true);
    expect(scan.errors.some((e) => e.reason.includes("UTF-8") || e.reason.includes("valid UTF-8"))).toBe(true);
  });

  it("detectHarnessSkills records read failures for unreadable markdown files (lines 709-714)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-b27-read-${crypto.randomUUID()}-`));
    tmpRoots.push(root);
    const harness = path.join(root, "hermes");
    fs.mkdirSync(harness, { recursive: true });
    const unreadable = path.join(harness, "unreadable-b27.md");
    fs.writeFileSync(unreadable, skillMd("unreadable-b27"), "utf8");
    fs.chmodSync(unreadable, 0o000);

    const { detectHarnessSkills } = await import("../skill-sync");
    const scan = detectHarnessSkills({ roots: { hermes: harness } });
    fs.chmodSync(unreadable, 0o644);
    expect(scan.errors.some((e) => e.reason.includes("Cannot read file"))).toBe(true);
  });

  it("detectHarnessSkills flags skills missing frontmatter name (lines 736-744)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-b27-fm-${crypto.randomUUID()}-`));
    tmpRoots.push(root);
    const harness = path.join(root, "opencode");
    fs.mkdirSync(harness, { recursive: true });
    fs.writeFileSync(path.join(harness, "fallback-only-b27.md"), "# No frontmatter\n", "utf8");

    const { detectHarnessSkills } = await import("../skill-sync");
    const scan = detectHarnessSkills({ roots: { opencode: harness } });
    const entry = scan.entries.find((e) => e.skill_name === "fallback-only-b27");
    expect(entry?.parse_error).toMatch(/frontmatter|fallback/i);
    expect(scan.errors.some((e) => e.reason.includes("frontmatter") || e.reason.includes("fallback"))).toBe(true);
  });

  it("diffSkills returns no_change and change field lists (lines 816-863)", async () => {
    const { diffSkills } = await import("../skill-sync");
    const name = `diff-b27-${crypto.randomUUID().slice(0, 8)}`;
    const bodyV1 = skillMd(name, "1.0.0");
    const hashV1 = computeContentHash(bodyV1);
    const bodyV2 = skillMd(name, "2.0.0");
    const hashV2 = computeContentHash(bodyV2);

    const unchanged = diffSkills(
      {
        skill_name: name,
        source_harness: "claude",
        version: "1.0.0",
        raw_body: bodyV1,
        content_hash: hashV1,
      },
      {
        skill_name: name,
        source_harness: "claude",
        version: "1.0.0",
        raw_body: bodyV1,
        content_hash: hashV1,
      },
    );
    expect(unchanged.kind).toBe("no_change");
    expect(unchanged.summary).toContain("No content drift");

    const changed = diffSkills(
      {
        skill_name: name,
        source_harness: "claude",
        version: "1.0.0",
        raw_body: bodyV1,
        content_hash: hashV1,
      },
      {
        skill_name: name,
        source_harness: "claude",
        version: "2.0.0",
        raw_body: bodyV2,
        content_hash: hashV2,
      },
    );
    expect(changed.kind).toBe("change");
    expect(changed.changed_fields.map((f) => f.field).sort()).toEqual(["content_hash", "raw_body", "version"]);
    expect(changed.summary.length).toBeGreaterThan(0);
  });
});
