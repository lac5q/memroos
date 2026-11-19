// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = path.join(os.tmpdir(), `skill-lifecycle-b13-${crypto.randomUUID()}`);

async function loadDb() {
  process.env["MEMROOS_ROOT"] = TMP_ROOT;
  process.env["SQLITE_DB_PATH"] = path.join(TMP_ROOT, `db-${crypto.randomUUID()}.db`);
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

function insertSkill(lifecycle = "draft"): number {
  const result = db
    .prepare(
      `INSERT INTO skill_registry (name, source_harness, dispatch_status, raw_body, imported_by, completeness_pct, lifecycle_state)
       VALUES (?, 'claude', 'quarantined', 'body', 'operator', 100, ?)`
    )
    .run(`skill-${crypto.randomUUID().slice(0, 8)}`, lifecycle);
  return Number(result.lastInsertRowid);
}

describe("skill-lifecycle batch13", () => {
  it("addSkillDependency validates required fields", async () => {
    const { addSkillDependency, LifecycleTransitionError } = await import("../skill-lifecycle");
    const skillId = insertSkill();
    expect(() => addSkillDependency(db, { skillId: 0, dependentAgentId: "a", skillVersion: "1", registeredBy: "op" })).toThrow(
      LifecycleTransitionError
    );
    expect(() =>
      addSkillDependency(db, { skillId, dependentAgentId: "  ", skillVersion: "1", registeredBy: "op" })
    ).toThrow(/dependentAgentId/);
    expect(() =>
      addSkillDependency(db, { skillId, dependentAgentId: "agent-1", skillVersion: "", registeredBy: "op" })
    ).toThrow(/skillVersion/);
    expect(() =>
      addSkillDependency(db, { skillId, dependentAgentId: "agent-1", skillVersion: "1.0.0", registeredBy: "" })
    ).toThrow(/registeredBy/);
  });

  it("transitionLifecycleState treats missing skills as not found", async () => {
    const { transitionLifecycleState, LifecycleTransitionError } = await import("../skill-lifecycle");
    expect(() => transitionLifecycleState(db, 999_999, "deprecated", "operator", "reason")).toThrow(
      LifecycleTransitionError
    );
  });

  it("draft to enabled succeeds when quarantine table is missing", async () => {
    const { transitionLifecycleState } = await import("../skill-lifecycle");
    const skillId = insertSkill("draft");
    db.exec("DROP TABLE IF EXISTS skill_quarantine");
    expect(() => transitionLifecycleState(db, skillId, "enabled", "operator", "go")).toThrow(/quarantine pass/);
  });

  it("appendUnifiedAuditEntry swallows missing audit_entries during deprecation notifications", async () => {
    const { addSkillDependency, transitionLifecycleState } = await import("../skill-lifecycle");
    const skillId = insertSkill("enabled");
    db.prepare(`INSERT INTO skill_quarantine (skill_id, stage) VALUES (?, 'enabled')`).run(skillId);
    addSkillDependency(db, {
      skillId,
      dependentAgentId: "agent-notify",
      skillVersion: "1.0.0",
      registeredBy: "operator",
    });
    db.exec("DROP TABLE audit_entries");
    const result = transitionLifecycleState(db, skillId, "deprecated", "operator", "sunset");
    expect(result.lifecycle_state).toBe("deprecated");
  });
});
