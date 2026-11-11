// @vitest-environment node
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

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

describe("skill-dependencies batch34 — mismatch flags and observation metadata", () => {
  it.skip("isObservationProvenance / isTrustedProvenance (132, 136) have no production call sites", () => {});

  it.skip("loadCapabilitiesReferencing early return (260) — view always resolves registry before capabilities", () => {});

  it("records pin hash and version mismatches in forward_consistency (367–370)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `mismatch-b34-${crypto.randomUUID().slice(0, 8)}`;
    const regHash = "a".repeat(64);
    const skillId = insertRegistrySkill(db, name, "2.0.0", regHash);
    const agentId = `agent-b34-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES (?, 'Pin', 'agent', 'memroos', 'local')`,
    ).run(agentId);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO skill_version_pins (agent_id, skill_id, skill_name, current_version, current_content_hash, actor, created_at, updated_at)
       VALUES (?, ?, ?, '9.9.9', ?, 'operator', ?, ?)`,
    ).run(agentId, skillId, name, "b".repeat(64), now, now);

    const view = getSkillDependencyView(db, skillId);
    expect(view.forward_consistency.ok).toBe(false);
    expect(view.forward_consistency.mismatches.some((m) => m.includes("content_hash"))).toBe(true);
    expect(view.forward_consistency.mismatches.some((m) => m.includes("version"))).toBe(true);
    db.close();
  });

  it("surfaces report observed_state from metadata (514) and deprecated marketplace rows (447)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `obs-b34-${crypto.randomUUID().slice(0, 8)}`;
    const skillId = insertRegistrySkill(db, name, "1.0.0", "c".repeat(64));
    db.prepare(
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES ('agent-b34', 'Obs', 'agent', 'memroos', 'local')`,
    ).run();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO agent_skill_reports (agent_id, skill_id, action, metadata, reported_at)
       VALUES ('agent-b34', ?, 'observed', '{"observed_state":"degraded"}', ?)`,
    ).run(String(skillId), now);
    db.prepare(
      `INSERT INTO skill_marketplace (id, skill_id, name, description, author, tags, version, changelog, rating, review_count, download_count, category, published_at, updated_at, deprecated)
       VALUES (?, ?, 'Listing', 'd', 'a', '[]', '0.5.0', 'c', 0, 0, 0, 'general', ?, ?, 1)`,
    ).run(`mkt-b34-${crypto.randomUUID().slice(0, 6)}`, String(skillId), now, now);

    const view = getSkillDependencyView(db, skillId);
    expect(view.observed.some((r) => r.reason === "degraded")).toBe(true);
    expect(view.trusted.some((r) => r.provenance === "marketplace" && r.status === "observed")).toBe(true);
    expect(view.forward_consistency.mismatches.some((m) => m.includes("marketplace"))).toBe(true);
    db.close();
  });

  it("loadTrustPins falls back to skill_name pins when skill_id query is empty (168)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `name-pin-b34-${crypto.randomUUID().slice(0, 8)}`;
    const skillId = insertRegistrySkill(db, name, "1.0.0", "d".repeat(64));
    const agentId = `agent-name-b34-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES (?, 'NamePin', 'agent', 'memroos', 'local')`,
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
});
