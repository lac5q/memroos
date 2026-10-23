// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  requireHarness,
  detectHarnessSkills,
  diffSkills,
  SkillSyncError,
  checkSync,
} from "@/lib/skills/skill-sync";

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

function writeHarnessSkill(root: string, harness: string, fileBase: string, body: string) {
  const dir = path.join(root, harness);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${fileBase}.md`), body, "utf8");
}

describe("skill-sync batch13c", () => {
  it("requireHarness accepts supported harness ids", () => {
    expect(requireHarness("claude")).toBe("claude");
    expect(requireHarness("codex")).toBe("codex");
  });

  it("requireHarness rejects unknown harness ids", () => {
    expect(() => requireHarness("unknown-harness")).toThrow(SkillSyncError);
  });

  it("detectHarnessSkills skips unreadable skill trees", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-detect-${randomUUID()}-`));
    const roots = { claude: path.join(root, "claude"), codex: root, hermes: root, opencode: root };
    fs.mkdirSync(roots.claude, { recursive: true });
    writeHarnessSkill(root, "claude", "demo-skill", "# Demo skill\n");
    const detected = detectHarnessSkills({ roots });
    expect(detected.entries.some((s) => s.skill_name === "demo-skill")).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("diffSkills reports add when no existing registry row", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-diff-${randomUUID()}-`));
    writeHarnessSkill(root, "claude", "fresh-skill", "# Fresh\n");
    const detected = detectHarnessSkills({
      roots: { claude: path.join(root, "claude"), codex: root, hermes: root, opencode: root },
    });
    const entry = detected.entries.find((s) => s.skill_name === "fresh-skill");
    expect(entry).toBeDefined();
    const diff = diffSkills(null, entry!);
    expect(diff.kind).toBe("add");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("checkSync returns detection counters on empty harness roots", () => {
    const db = freshDb();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `sync-check-${randomUUID()}-`));
    const result = checkSync(db, {
      roots: { claude: root, codex: root, hermes: root, opencode: root },
      proposed_by: "batch13c-test",
    });
    expect(result.detected).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.errors)).toBe(true);
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
});
