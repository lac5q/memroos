// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = path.join(os.tmpdir(), `skill-deps-b13-${crypto.randomUUID()}`);

async function loadDb() {
  const root = path.join(TMP_ROOT, `db-${crypto.randomUUID()}`);
  fs.mkdirSync(root, { recursive: true });
  process.env["MEMROOS_ROOT"] = root;
  process.env["SQLITE_DB_PATH"] = path.join(root, "test.db");
  vi.resetModules();
  const { getDb, closeDb } = await import("@/lib/db");
  const { initSchema } = await import("@/lib/db-schema");
  const db = getDb();
  initSchema(db);
  return { db, closeDb };
}

let db: import("better-sqlite3").Database;
let closeDb: () => void;

beforeEach(async () => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const mods = await loadDb();
  db = mods.db;
  closeDb = mods.closeDb;
});

afterEach(() => {
  try {
    closeDb();
  } catch {
    /* ignore */
  }
  delete process.env["MEMROOS_ROOT"];
  delete process.env["SQLITE_DB_PATH"];
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

function insertRegistry(name: string, id?: number): number {
  const skillId = id ?? Number(
    db
      .prepare(
        `INSERT INTO skill_registry (name, source_harness, version, content_hash, raw_body, imported_by, dispatch_status, completeness_pct, lifecycle_state, preconditions)
         VALUES (?, 'claude', '1.0.0', ?, 'body', 'operator', 'enabled', 100, 'enabled', '')`
      )
      .run(name, "0".repeat(64)).lastInsertRowid
  );
  return skillId;
}

describe("skill-dependencies batch13", () => {
  it("includes dispatch provenance from hive_delegations metadata", async () => {
    const { getSkillDependencyView } = await import("../skill-dependencies");
    const skillId = insertRegistry("dispatch-skill");
    try {
      db.exec(`ALTER TABLE hive_delegations ADD COLUMN started_at TEXT`);
    } catch {
      /* column may already exist in newer schemas */
    }
    try {
      db.exec(`ALTER TABLE hive_delegations ADD COLUMN result TEXT`);
    } catch {
      /* column may already exist */
    }
    const payload = JSON.stringify({ skill_id: skillId, note: "used skill" });
    db.prepare(
      `INSERT INTO hive_delegations (task_id, from_agent, to_agent, task_summary, checkpoint, result, status, started_at)
       VALUES (?, 'agent-a', 'agent-b', 'dispatch task', ?, ?, 'completed', ?)`
    ).run(crypto.randomUUID(), payload, payload, new Date().toISOString());
    const view = getSkillDependencyView(db, skillId);
    expect(view.trusted.some((row) => row.provenance === "dispatch")).toBe(true);
  });

  it("summarizeDependencyView returns stable counts", async () => {
    const { getSkillDependencyView, summarizeDependencyView } = await import("../skill-dependencies");
    const skillId = insertRegistry("summary-skill");
    const view = getSkillDependencyView(db, skillId);
    const summary = summarizeDependencyView(view);
    expect(summary.skill_id).toBe(skillId);
    expect(summary.trusted_count).toBe(view.trusted.length);
  });

  it("getReverseDependencyView lists skill dependents referenced in preconditions", async () => {
    const { getReverseDependencyView } = await import("../skill-dependencies");
    const parentId = insertRegistry("parent-skill");
    insertRegistry("child-skill");
    db.prepare(`UPDATE skill_registry SET preconditions = ? WHERE name = 'child-skill'`).run(
      `requires parent-skill from claude harness`
    );
    const reverse = getReverseDependencyView(db, parentId);
    expect(reverse.some((row) => row.dependent_kind === "skill" && row.via === "config")).toBe(true);
  });
});
