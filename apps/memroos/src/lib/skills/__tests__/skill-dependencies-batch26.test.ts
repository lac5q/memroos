// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { getReverseDependencyView, getSkillDependencyView } from "../skill-dependencies";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

function insertSkill(database: Database.Database, name: string): { id: number; hash: string; body: string } {
  const body = `body-${name}`;
  const hash = createHash("sha256").update(body).digest("hex");
  const id = Number(
    database
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
            version, preconditions, allowed_tools, verification_checks, rollback_behavior,
            raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
            evidence_examples, content_hash, trust_level, lifecycle_state)
           VALUES (?, '', 'ops', 'memroos', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned', 'enabled')`,
      )
      .run(name, body, new Date().toISOString(), hash)
      .lastInsertRowid,
  );
  return { id, hash, body };
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("skill-dependencies batch26 — dependency edges, dispatch filter, reverse trusted", () => {
  it("includes skill_dependencies rows as trusted pin-style provenance", () => {
    const database = freshDb();
    const skillName = `dep-edge-${randomUUID().slice(0, 6)}`;
    const { id: skillId } = insertSkill(database, skillName);
    database.prepare(
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES ('agent-b26', 'Dep', 'agent', 'memroos', 'local')`,
    ).run();
    database
      .prepare(
        `INSERT INTO skill_dependencies
           (skill_id, dependent_agent_id, skill_version, registered_by, created_at, updated_at)
         VALUES (?, 'agent-b26', '1.0.0', 'operator', datetime('now'), datetime('now'))`,
      )
      .run(skillId);
    const view = getSkillDependencyView(database, skillId);
    expect(view.trusted.some((row) => row.provenance === "pin" && row.id.startsWith("pin:"))).toBe(true);
    const reverse = getReverseDependencyView(database, skillId);
    expect(reverse.some((row) => row.via === "pin" && row.is_trusted)).toBe(true);
  });

  it("skips dispatch receipts whose payload skill_id does not match registry id", () => {
    const database = freshDb();
    const skillName = `dispatch-skip-${randomUUID().slice(0, 6)}`;
    const { id: skillId } = insertSkill(database, skillName);
    try {
      database.exec(`ALTER TABLE hive_delegations ADD COLUMN started_at TEXT`);
    } catch {
      /* exists */
    }
    const otherPayload = JSON.stringify({ skill_id: skillId + 999, note: "wrong id" });
    database
      .prepare(
        `INSERT INTO hive_delegations (task_id, from_agent, to_agent, task_summary, checkpoint, result, status, started_at)
         VALUES (?, 'from', 'to', 'wrong skill id', ?, ?, 'completed', ?)`,
      )
      .run(randomUUID(), otherPayload, otherPayload, new Date().toISOString());
    const view = getSkillDependencyView(database, skillId);
    expect(view.trusted.filter((row) => row.provenance === "dispatch")).toHaveLength(0);
  });

  it("loadTrustPins resolves by skill_name when skill_id column is null", () => {
    const database = freshDb();
    const skillName = `pin-null-id-${randomUUID().slice(0, 6)}`;
    const { id: skillId, hash } = insertSkill(database, skillName);
    database.prepare(
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES ('pin-agent-b26', 'Pin', 'agent', 'memroos', 'local')`,
    ).run();
    database
      .prepare(
        `INSERT INTO skill_version_pins
           (agent_id, skill_name, skill_id, current_version, current_content_hash, actor)
         VALUES ('pin-agent-b26', ?, NULL, '1.0.0', ?, 'operator')`,
      )
      .run(skillName, hash);
    const view = getSkillDependencyView(database, skillId);
    expect(view.trusted.some((row) => row.provenance === "pin")).toBe(true);
  });

  it("observation provenance stays non-trusted for capability reports", () => {
    const database = freshDb();
    const skillName = `obs-${randomUUID().slice(0, 6)}`;
    const { id: skillId } = insertSkill(database, skillName);
    database.prepare(
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES ('cap-b26', 'Cap', 'agent', 'memroos', 'local')`,
    ).run();
    database
      .prepare(
        `INSERT INTO agent_capabilities (agent_id, capability_id, name, description)
         VALUES ('cap-b26', ?, ?, 'observed only')`,
      )
      .run(skillName, skillName);
    const view = getSkillDependencyView(database, skillId);
    const cap = view.observed.find((row) => row.provenance === "capability");
    expect(cap?.is_trusted).toBe(false);
    expect(cap?.is_observation).toBe(true);
  });
});
