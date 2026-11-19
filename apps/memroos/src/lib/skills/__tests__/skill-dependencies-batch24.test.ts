// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { getSkillDependencyView } from "../skill-dependencies";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

function insertSkill(database: Database.Database, name: string): number {
  const body = `body-${name}`;
  return Number(
    database
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
            version, preconditions, allowed_tools, verification_checks, rollback_behavior,
            raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
            evidence_examples, content_hash, trust_level)
           VALUES (?, '', 'ops', 'memroos', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
      )
      .run(name, body, new Date().toISOString(), crypto.createHash("sha256").update(body).digest("hex"))
      .lastInsertRowid,
  );
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("skill-dependencies batch24 — missing registry, dispatch filters, reports", () => {
  it("returns empty provenance when registry row is missing", () => {
    const database = freshDb();
    const view = getSkillDependencyView(database, 999_999);
    expect(view.trusted).toHaveLength(0);
    expect(view.forward_consistency.ok).toBe(false);
  });

  it("skips dispatch rows whose metadata skill_id does not match registry id", () => {
    const database = freshDb();
    const skillId = insertSkill(database, `dispatch-b24-${crypto.randomUUID().slice(0, 6)}`);
    try {
      database.exec(`ALTER TABLE hive_delegations ADD COLUMN started_at TEXT`);
    } catch {
      /* already present */
    }
    const wrong = JSON.stringify({ skill_id: skillId + 1, note: "wrong" });
    const right = JSON.stringify({ skill_id: skillId, note: "right" });
    database
      .prepare(
        `INSERT INTO hive_delegations (task_id, from_agent, to_agent, task_summary, checkpoint, result, status, started_at)
         VALUES (?, 'a1', 'a2', 'wrong', ?, ?, 'completed', ?)`,
      )
      .run(crypto.randomUUID(), wrong, wrong, new Date().toISOString());
    database
      .prepare(
        `INSERT INTO hive_delegations (task_id, from_agent, to_agent, task_summary, checkpoint, result, status, started_at)
         VALUES (?, 'a1', 'a2', 'right', ?, ?, 'completed', ?)`,
      )
      .run(crypto.randomUUID(), right, right, new Date().toISOString());
    const view = getSkillDependencyView(database, skillId);
    expect(view.trusted.filter((row) => row.provenance === "dispatch")).toHaveLength(1);
  });

  it("loads agent_skill_reports by skill name when registry row exists", () => {
    const database = freshDb();
    const skillName = `report-b24-${crypto.randomUUID().slice(0, 6)}`;
    const skillId = insertSkill(database, skillName);
    database.prepare(
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES ('agent-b24', 'Rep', 'agent', 'memroos', 'local')`,
    ).run();
    database
      .prepare(
        `INSERT INTO agent_skill_reports (agent_id, skill_id, action, metadata, reported_at)
         VALUES ('agent-b24', ?, 'invoked', ?, ?)`,
      )
      .run(skillName, JSON.stringify({ observed_state: "batch24" }), new Date().toISOString());
    const view = getSkillDependencyView(database, skillId);
    expect(view.observed.some((row) => row.provenance === "report")).toBe(true);
  });
});
