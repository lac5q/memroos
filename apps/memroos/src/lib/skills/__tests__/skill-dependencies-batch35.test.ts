// @vitest-environment node
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { getSkillDependencyView } from "../skill-dependencies";

function insertRegistrySkill(database: Database.Database, name: string, version: string, hash: string): number {
  const body = `body-${crypto.randomUUID()}`;
  return Number(
    database
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level)
         VALUES (?, '', 'ops', 'memroos', 'low', 'enabled', ?, '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
      )
      .run(name, version, body, new Date().toISOString(), hash)
      .lastInsertRowid,
  );
}

describe("skill-dependencies batch35", () => {
  it.skip("isObservationProvenance / isTrustedProvenance (132, 136) have no production call sites", () => {});

  it.skip("loadCapabilitiesReferencing early return (260) — view always resolves registry before capabilities", () => {});

  it("loadTrustPins falls back to skill_name when skill_id pins are absent (168–176)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `pin-fallback-b35-${crypto.randomUUID().slice(0, 8)}`;
    const skillId = insertRegistrySkill(db, name, "1.0.0", "f".repeat(64));
    const agentId = `agent-pin-b35-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES (?, 'Pin', 'agent', 'memroos', 'local')`,
    ).run(agentId);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO skill_version_pins (agent_id, skill_id, skill_name, current_version, current_content_hash, actor, created_at, updated_at)
       VALUES (?, NULL, ?, '1.0.0', ?, 'operator', ?, ?)`,
    ).run(agentId, name, "e".repeat(64), now, now);
    const view = getSkillDependencyView(db, skillId);
    expect(view.trusted.some((row) => row.provenance === "pin" && row.scope.agent_id === agentId)).toBe(true);
    db.close();
  });

  it("reports trusted pin provenance from skill_dependencies ledger", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `edge-b35-${crypto.randomUUID().slice(0, 8)}`;
    const skillId = insertRegistrySkill(db, name, "1.0.0", "a".repeat(64));
    const agentId = `agent-edge-b35-${crypto.randomUUID().slice(0, 6)}`;
    db.prepare(
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES (?, 'Edge', 'agent', 'memroos', 'local')`,
    ).run(agentId);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO skill_dependencies (skill_id, dependent_agent_id, skill_version, registered_by, created_at, updated_at)
       VALUES (?, ?, '1.0.0', 'batch35', ?, ?)`,
    ).run(skillId, agentId, now, now);
    const view = getSkillDependencyView(db, skillId);
    expect(view.trusted.some((row) => row.provenance === "pin" && row.scope.agent_id === agentId)).toBe(true);
    db.close();
  });
});
