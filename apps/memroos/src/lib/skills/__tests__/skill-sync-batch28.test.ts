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
    try {
      fs.chmodSync(root, 0o755);
    } catch {
      // ignore
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
  tmpRoots.length = 0;
  const signingKey = path.join(process.cwd(), "data", "skill-signing-key.json");
  if (fs.existsSync(signingKey)) fs.unlinkSync(signingKey);
  vi.restoreAllMocks();
});

describe("skill-sync batch28 — requireHarness, diff add, scanner stat/readdir, checkSync", () => {
  it("requireHarness rejects unsupported harness names (lines 404-407)", async () => {
    const { requireHarness } = await import("../skill-sync");
    expect(() => requireHarness("unknown-harness-b28")).toThrow(/Unsupported source_harness/);
  });

  it("diffSkills returns add when no registry row exists (lines 801-812)", async () => {
    const { diffSkills } = await import("../skill-sync");
    const name = `add-b28-${crypto.randomUUID().slice(0, 8)}`;
    const body = skillMd(name, "0.1.0");
    const hash = computeContentHash(body);
    const diff = diffSkills(null, {
      skill_name: name,
      source_harness: "codex",
      version: "0.1.0",
      raw_body: body,
      content_hash: hash,
    });
    expect(diff.kind).toBe("add");
    expect(diff.summary).toContain("New skill detected");
  });

  it("detectHarnessSkills refuses symlink harness roots (lines 614-620)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-b28-rootlink-${crypto.randomUUID()}-`));
    tmpRoots.push(root);
    const realHarness = path.join(root, "real-claude");
    fs.mkdirSync(realHarness, { recursive: true });
    fs.writeFileSync(path.join(realHarness, "inside-b28.md"), skillMd("inside-b28"), "utf8");
    const harnessLink = path.join(root, "claude");
    try {
      fs.symlinkSync(realHarness, harnessLink);
    } catch {
      return;
    }
    const { detectHarnessSkills } = await import("../skill-sync");
    const scan = detectHarnessSkills({ roots: { claude: harnessLink } });
    expect(scan.errors.some((e) => e.reason.includes("harness root is a symlink"))).toBe(true);
  });

  it("detectHarnessSkills records Cannot read directory when readdir fails (lines 636-642)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-b28-readdir-${crypto.randomUUID()}-`));
    tmpRoots.push(root);
    const harness = path.join(root, "hermes");
    fs.mkdirSync(harness, { recursive: true });
    fs.writeFileSync(path.join(harness, "hidden.md"), skillMd("hidden-b28"), "utf8");
    fs.chmodSync(harness, 0o000);

    const { detectHarnessSkills } = await import("../skill-sync");
    const scan = detectHarnessSkills({ roots: { hermes: harness } });
    fs.chmodSync(harness, 0o755);
    expect(scan.errors.some((e) => e.reason.includes("Cannot read directory"))).toBe(true);
  });

  it("checkSync skips entries with parse_error and counts unchanged (lines 2104-2138)", async () => {
    const database = freshDb();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-b28-check-${crypto.randomUUID()}-`));
    tmpRoots.push(root);
    const harness = path.join(root, "codex");
    fs.mkdirSync(harness, { recursive: true });

    const stableName = `stable-b28-${crypto.randomUUID().slice(0, 6)}`;
    const body = skillMd(stableName, "1.0.0");
    const hash = computeContentHash(body);
    fs.writeFileSync(path.join(harness, `${stableName}.md`), body, "utf8");
    fs.writeFileSync(path.join(harness, "no-frontmatter-b28.md"), "# parse error path\n", "utf8");

    database
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level)
         VALUES (?, '', 'ops', 'codex', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
      )
      .run(stableName, body, new Date().toISOString(), hash);

    const { checkSync } = await import("../skill-sync");
    const result = checkSync(database, { roots: { codex: harness }, proposed_by: "batch28" });
    expect(result.unchanged).toBeGreaterThanOrEqual(1);
    expect(result.created).toBe(0);
    expect(result.errors.some((e) => /frontmatter|fallback/i.test(e.reason))).toBe(true);
  });
});
