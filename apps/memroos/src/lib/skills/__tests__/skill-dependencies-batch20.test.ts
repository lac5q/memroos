// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";

function insertRegisteredAgent(db: Database.Database, id: string) {
  db.prepare(
    `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES (?, ?, 'agent', 'memroos', 'local')`,
  ).run(id, `agent-${id}`);
}

function insertSkill(db: Database.Database, name: string): number {
  const body = `body-${crypto.randomUUID().slice(0, 6)}`;
  return Number(
    db
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level)
         VALUES (?, '', 'ops', 'claude', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
      )
      .run(name, body, new Date().toISOString(), crypto.createHash("sha256").update(body).digest("hex"))
      .lastInsertRowid,
  );
}

describe("skill-dependencies batch20 — observation provenance and dispatch filter", () => {
  it("getSkillDependencyView loads pins by skill_name when skill_id is null", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `dep-b20-${crypto.randomUUID().slice(0, 6)}`;
    const skillId = insertSkill(db, name);
    insertRegisteredAgent(db, "agent-pin");
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO skill_version_pins (agent_id, skill_name, current_version, current_content_hash, actor, created_at, updated_at)
       VALUES ('agent-pin', ?, '1.0.0', ?, 'operator', ?, ?)`,
    ).run(name, "a".repeat(64), now, now);
    const { getSkillDependencyView } = await import("../skill-dependencies");
    const view = getSkillDependencyView(db, skillId);
    expect(view.trusted.some((row) => row.provenance === "pin" && row.scope.agent_id === "agent-pin")).toBe(true);
    db.close();
  });

  it("getSkillDependencyView classifies report and capability rows as observations", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `obs-b20-${crypto.randomUUID().slice(0, 6)}`;
    const skillId = insertSkill(db, name);
    insertRegisteredAgent(db, "agent-report");
    insertRegisteredAgent(db, "agent-cap");
    db.prepare(
      `INSERT INTO agent_skill_reports (agent_id, skill_id, action, metadata, reported_at)
       VALUES ('agent-report', ?, 'observed', '{bad-json', ?)`,
    ).run(String(skillId), new Date().toISOString());
    db.prepare(
      `INSERT INTO agent_capabilities (agent_id, capability_id, name, description, created_at)
       VALUES ('agent-cap', ?, ?, 'capability observation', ?)`,
    ).run(name, name, new Date().toISOString());
    const { getSkillDependencyView } = await import("../skill-dependencies");
    const view = getSkillDependencyView(db, skillId);
    expect(view.observed.some((row) => row.provenance === "report")).toBe(true);
    expect(view.observed.some((row) => row.provenance === "capability")).toBe(true);
    db.close();
  });

  it("getSkillDependencyView ignores dispatch rows whose payload skill_id mismatches", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertSkill(db, `dispatch-b20-${crypto.randomUUID().slice(0, 6)}`);
    db.prepare(
      `INSERT INTO hive_delegations (task_id, from_agent, to_agent, task_summary, checkpoint, result, created_at, updated_at)
       VALUES (?, 'from-agent', 'to-agent', 'dispatch test', '{}', ?, ?, ?)`,
    ).run(
      `task-${crypto.randomUUID().slice(0, 8)}`,
      JSON.stringify({ skill_id: skillId + 99 }),
      new Date().toISOString(),
      new Date().toISOString(),
    );
    const { getSkillDependencyView } = await import("../skill-dependencies");
    const view = getSkillDependencyView(db, skillId);
    expect(view.trusted.some((row) => row.provenance === "dispatch")).toBe(false);
    db.close();
  });
});
