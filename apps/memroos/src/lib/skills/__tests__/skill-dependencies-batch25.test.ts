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

function insertSkill(database: Database.Database, name: string, version = "1.0.0"): { id: number; hash: string } {
  const body = `body-${name}`;
  const hash = createHash("sha256").update(body).digest("hex");
  const id = Number(
    database
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
            version, preconditions, allowed_tools, verification_checks, rollback_behavior,
            raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
            evidence_examples, content_hash, trust_level, lifecycle_state)
           VALUES (?, '', 'ops', 'memroos', 'low', 'enabled', ?, '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned', 'enabled')`,
      )
      .run(name, version, body, new Date().toISOString(), hash)
      .lastInsertRowid,
  );
  return { id, hash };
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("skill-dependencies batch25 — pins, marketplace, dispatch, reverse view", () => {
  it("loads version pins by skill_name when skill_id pin rows are absent", () => {
    const database = freshDb();
    const skillName = `pin-name-${randomUUID().slice(0, 6)}`;
    const { id: skillId, hash } = insertSkill(database, skillName);
    database.prepare(
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES ('agent-b25', 'Pin', 'agent', 'memroos', 'local')`,
    ).run();
    database
      .prepare(
        `INSERT INTO skill_version_pins
           (agent_id, skill_name, skill_id, current_version, current_content_hash, actor)
         VALUES ('agent-b25', ?, NULL, '1.0.0', ?, 'operator')`,
      )
      .run(skillName, hash);
    const view = getSkillDependencyView(database, skillId);
    expect(view.trusted.some((row) => row.provenance === "pin")).toBe(true);
  });

  it("records forward_consistency mismatches for pin hash and marketplace version drift", () => {
    const database = freshDb();
    const skillName = `mismatch-${randomUUID().slice(0, 6)}`;
    const { id: skillId, hash } = insertSkill(database, skillName, "2.0.0");
    database.prepare(
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES ('agent-b25', 'Pin', 'agent', 'memroos', 'local')`,
    ).run();
    database
      .prepare(
        `INSERT INTO skill_version_pins
           (agent_id, skill_name, skill_id, current_version, current_content_hash, actor)
         VALUES ('agent-b25', ?, ?, '1.0.0', ?, 'operator')`,
      )
      .run(skillName, skillId, `${hash.slice(0, 8)}deadbeef`);
    const ts = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO skill_marketplace
           (id, skill_id, name, description, author, version, category, published_at, updated_at, deprecated)
         VALUES (?, ?, ?, 'desc', 'author', '9.9.9', 'testing', ?, ?, 1)`,
      )
      .run(`mkt-${randomUUID()}`, String(skillId), skillName, ts, ts);
    const view = getSkillDependencyView(database, skillId);
    expect(view.forward_consistency.ok).toBe(false);
    expect(view.forward_consistency.mismatches.length).toBeGreaterThan(0);
    const marketplace = view.trusted.find((row) => row.provenance === "marketplace");
    expect(marketplace?.status).toBe("observed");
  });

  it("includes dispatch provenance and skips malformed delegation payloads", () => {
    const database = freshDb();
    const skillName = `dispatch-${randomUUID().slice(0, 6)}`;
    const { id: skillId } = insertSkill(database, skillName);
    try {
      database.exec(`ALTER TABLE hive_delegations ADD COLUMN started_at TEXT`);
    } catch {
      /* column exists */
    }
    const good = JSON.stringify({ skill_id: skillId, note: "batch25" });
    database
      .prepare(
        `INSERT INTO hive_delegations (task_id, from_agent, to_agent, task_summary, checkpoint, result, status, started_at)
         VALUES (?, 'from-agent', 'to-agent', 'dispatch ok', ?, ?, 'completed', ?)`,
      )
      .run(randomUUID(), good, good, new Date().toISOString());
    database
      .prepare(
        `INSERT INTO hive_delegations (task_id, from_agent, to_agent, task_summary, checkpoint, result, status, started_at)
         VALUES (?, 'from-agent', 'to-agent', 'bad json', ?, ?, 'completed', ?)`,
      )
      .run(randomUUID(), "{not-json", "{not-json", new Date().toISOString());
    const view = getSkillDependencyView(database, skillId);
    expect(view.trusted.filter((row) => row.provenance === "dispatch")).toHaveLength(1);
  });

  it("surfaces capability observations and reverse dependency rows", () => {
    const database = freshDb();
    const skillName = `cap-${randomUUID().slice(0, 6)}`;
    const { id: skillId } = insertSkill(database, skillName);
    database.prepare(
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES ('cap-agent', 'Cap', 'agent', 'memroos', 'local')`,
    ).run();
    database
      .prepare(
        `INSERT INTO agent_capabilities (agent_id, capability_id, name, description)
         VALUES ('cap-agent', ?, ?, 'observed capability')`,
      )
      .run(skillName, skillName);
    database
      .prepare(
        `INSERT INTO agent_skill_reports (agent_id, skill_id, action, metadata, reported_at)
         VALUES ('cap-agent', ?, 'invoked', ?, ?)`,
      )
      .run(skillName, JSON.stringify({ observed_state: "batch25-report" }), new Date().toISOString());
    const view = getSkillDependencyView(database, skillId);
    expect(view.observed.some((row) => row.provenance === "capability")).toBe(true);
    expect(view.observed.some((row) => row.provenance === "report")).toBe(true);
    const reverse = getReverseDependencyView(database, skillId);
    expect(reverse.some((row) => row.via === "capability" && row.is_observation)).toBe(true);
    expect(reverse.some((row) => row.via === "report" && !row.is_trusted)).toBe(true);
  });
});
