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

describe("skill-dependencies batch23 — observation vs trusted and dispatch receipts", () => {
  it("classifies marketplace and capability rows as observation-only", () => {
    const database = freshDb();
    const skillName = `obs-b23-${crypto.randomUUID().slice(0, 6)}`;
    const skillId = insertSkill(database, skillName);
    database.prepare(
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES ('agent-cap-b23', 'Cap', 'agent', 'memroos', 'local')`,
    ).run();
    database
      .prepare(
        `INSERT INTO agent_capabilities (agent_id, capability_id, name, description, created_at)
         VALUES ('agent-cap-b23', ?, ?, 'capability match', ?)`,
      )
      .run(skillName, skillName, new Date().toISOString());
    database
      .prepare(
        `INSERT INTO skill_marketplace (id, skill_id, name, description, author, tags, version, changelog, rating, review_count, download_count, category, published_at, updated_at, deprecated)
         VALUES ('market-b23', ?, 'listed', 'd', 'a', '[]', '1.0.0', 'c', 0, 0, 0, 'general', ?, ?, 0)`,
      )
      .run(String(skillId), new Date().toISOString(), new Date().toISOString());

    const view = getSkillDependencyView(database, skillId);
    expect(view.observed.some((row) => row.provenance === "capability")).toBe(true);
    expect(view.trusted.some((row) => row.provenance === "marketplace")).toBe(true);
    expect(view.trusted.every((row) => row.is_observation === false)).toBe(true);
  });

  it("records agent_skill_reports as observation-only report provenance", () => {
    const database = freshDb();
    const skillName = `report-b23-${crypto.randomUUID().slice(0, 6)}`;
    const skillId = insertSkill(database, skillName);
    database.prepare(
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES ('agent-report-b23', 'Rep', 'agent', 'memroos', 'local')`,
    ).run();
    database
      .prepare(
        `INSERT INTO agent_skill_reports (agent_id, skill_id, action, metadata, reported_at)
         VALUES ('agent-report-b23', ?, 'invoked', ?, ?)`,
      )
      .run(skillName, JSON.stringify({ observed_state: "seen" }), new Date().toISOString());
    const view = getSkillDependencyView(database, skillId);
    expect(view.observed.some((row) => row.provenance === "report" && row.reason === "seen")).toBe(true);
  });

  it("loadTrustPins falls back to skill_name when skill_id pins are absent", () => {
    const database = freshDb();
    const skillName = `pin-name-b23-${crypto.randomUUID().slice(0, 6)}`;
    const skillId = insertSkill(database, skillName);
    database.prepare(
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES ('agent-pin-b23', 'Pin', 'agent', 'memroos', 'local')`,
    ).run();
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO skill_version_pins (agent_id, skill_name, current_version, current_content_hash, actor, created_at, updated_at)
         VALUES ('agent-pin-b23', ?, '1.0.0', ?, 'operator', ?, ?)`,
      )
      .run(skillName, "a".repeat(64), now, now);
    const view = getSkillDependencyView(database, skillId);
    expect(view.trusted.some((row) => row.provenance === "pin")).toBe(true);
  });
});
