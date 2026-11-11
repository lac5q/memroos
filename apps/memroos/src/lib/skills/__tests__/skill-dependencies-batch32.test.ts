// @vitest-environment node
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  getReverseDependencyView,
  getSkillDependencyView,
  summarizeDependencyView,
} from "../skill-dependencies";

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

afterEach(() => {
  // per-test db.close()
});

describe("skill-dependencies batch32 — provenance flags and config reverse edges", () => {
  // sticky: isObservationProvenance / isTrustedProvenance (132, 136) are never invoked — rows hard-code flags.

  it("trusted pin rows contrast observation report/capability slices (public provenance APIs)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `dep-b32-${crypto.randomUUID().slice(0, 8)}`;
    const skillId = insertRegistrySkill(db, name);
    const agentId = `agent-b32-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES (?, 'Dep', 'agent', 'memroos', 'local')`,
    ).run(agentId);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO skill_version_pins (agent_id, skill_id, skill_name, current_version, current_content_hash, actor, created_at, updated_at)
       VALUES (?, ?, ?, '1.0.0', ?, 'operator', ?, ?)`,
    ).run(agentId, skillId, name, "b".repeat(64), now, now);
    db.prepare(
      `INSERT INTO agent_capabilities (agent_id, capability_id, name, description, tags, created_at, updated_at)
       VALUES (?, ?, ?, 'batch32 capability', '[]', ?, ?)`,
    ).run(agentId, name, name, now, now);
    db.prepare(
      `INSERT INTO agent_skill_reports (agent_id, skill_id, action, metadata, reported_at)
       VALUES (?, ?, 'observed', '{"observed_state":"enabled"}', ?)`,
    ).run(agentId, name, now);

    const view = getSkillDependencyView(db, skillId);
    const trusted = view.trusted.filter((r) => r.provenance === "pin");
    const observed = view.observed.filter((r) => r.provenance === "report" || r.provenance === "capability");
    expect(trusted.every((r) => r.is_trusted && !r.is_observation)).toBe(true);
    expect(observed.every((r) => !r.is_trusted && r.is_observation)).toBe(true);
    expect(summarizeDependencyView(view).trusted_count).toBeGreaterThanOrEqual(1);
    expect(summarizeDependencyView(view).observed_count).toBeGreaterThanOrEqual(2);

    const reverse = getReverseDependencyView(db, skillId);
    expect(reverse.some((r) => r.via === "pin" && r.is_trusted)).toBe(true);
    expect(reverse.some((r) => r.via === "report" && r.is_observation)).toBe(true);
    db.close();
  });

  it("reverse view lists skill dependents discovered via precondition references (config provenance)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const upstream = `upstream-b32-${crypto.randomUUID().slice(0, 8)}`;
    const downstream = `downstream-b32-${crypto.randomUUID().slice(0, 8)}`;
    const upstreamId = insertRegistrySkill(db, upstream);
    insertRegistrySkill(db, downstream);
    db.prepare(`UPDATE skill_registry SET preconditions = ? WHERE name = ?`).run(
      `requires skill ${upstream}`,
      downstream,
    );

    const reverse = getReverseDependencyView(db, upstreamId);
    expect(reverse.some((row) => row.via === "config" && row.dependent_kind === "skill")).toBe(true);
    db.close();
  });
});
