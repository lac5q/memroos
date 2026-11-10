// @vitest-environment node
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { getReverseDependencyView, getSkillDependencyView } from "../skill-dependencies";

function insertRegistrySkill(database: Database.Database, name: string): number {
  const body = `body-${crypto.randomUUID()}`;
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

describe("skill-dependencies batch33 — pin name fallback and missing registry guards", () => {
  it.skip("isObservationProvenance / isTrustedProvenance (132, 136) have no production call sites", () => {});

  it.skip("loadCapabilitiesReferencing early return when registry row missing (260) — view loader always resolves registry first", () => {});

  it("loadTrustPins falls back to skill_name when skill_id pins are absent (168)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `dep-b33-${crypto.randomUUID().slice(0, 8)}`;
    const skillId = insertRegistrySkill(db, name);
    const agentId = `agent-b33-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES (?, 'Dep', 'agent', 'memroos', 'local')`,
    ).run(agentId);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO skill_version_pins (agent_id, skill_id, skill_name, current_version, current_content_hash, actor, created_at, updated_at)
       VALUES (?, NULL, ?, '1.0.0', ?, 'operator', ?, ?)`,
    ).run(agentId, name, "c".repeat(64), now, now);

    const view = getSkillDependencyView(db, skillId);
    expect(view.trusted.some((row) => row.provenance === "pin" && row.scope.agent_id === agentId)).toBe(true);
    db.close();
  });

  it("getSkillDependencyView returns empty slices for unknown registry ids (168 guard via missing row)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const ghostId = 9_999_001;
    const view = getSkillDependencyView(db, ghostId);
    expect(view.forward_consistency.ok).toBe(false);
    expect(view.trusted).toHaveLength(0);
    const reverse = getReverseDependencyView(db, ghostId);
    expect(reverse).toHaveLength(0);
    db.close();
  });
});
