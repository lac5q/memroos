// @vitest-environment node
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { getSkillDependencyView } from "../skill-dependencies";

function insertRegistrySkill(database: Database.Database, name: string): number {
  const body = `body-${randomUUID()}`;
  return Number(
    database
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level)
         VALUES (?, '', 'ops', 'memroos', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
      )
      .run(name, body, new Date().toISOString(), createHash("sha256").update(body).digest("hex"))
      .lastInsertRowid,
  );
}

describe("skill-dependencies batch38 — loadTrustPins name-only pins", () => {
  it("loadTrustPins uses skill_name query when skill_id pins belong to another skill (169–177)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `dep-b38-${randomUUID().slice(0, 8)}`;
    const otherName = `other-b38-${randomUUID().slice(0, 8)}`;
    const skillId = insertRegistrySkill(db, name);
    const otherSkillId = insertRegistrySkill(db, otherName);
    const agentId = `agent-pin-b38-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES (?, 'Pin', 'agent', 'memroos', 'local')`,
    ).run(agentId);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO skill_version_pins (agent_id, skill_id, skill_name, current_version, current_content_hash, actor, created_at, updated_at)
       VALUES (?, ?, ?, '1.0.0', ?, 'operator', ?, ?)`,
    ).run(agentId, otherSkillId, name, "d".repeat(64), now, now);

    const view = getSkillDependencyView(db, skillId);
    expect(view.trusted.some((row) => row.provenance === "pin" && row.scope.agent_id === agentId)).toBe(true);
    db.close();
  });

  it("loadTrustPins returns no pin rows when registry exists but only wrong skill_name pins", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `target-b38-${randomUUID().slice(0, 8)}`;
    const skillId = insertRegistrySkill(db, name);
    const agentId = `agent-miss-b38-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES (?, 'Pin', 'agent', 'memroos', 'local')`,
    ).run(agentId);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO skill_version_pins (agent_id, skill_id, skill_name, current_version, current_content_hash, actor, created_at, updated_at)
       VALUES (?, NULL, ?, '1.0.0', ?, 'operator', ?, ?)`,
    ).run(agentId, "not-the-skill-name", "e".repeat(64), now, now);

    const view = getSkillDependencyView(db, skillId);
    expect(view.trusted.filter((row) => row.provenance === "pin")).toHaveLength(0);
    db.close();
  });
});