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

function insertSkill(database: Database.Database, name: string): { id: number; hash: string } {
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
  return { id, hash };
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("skill-dependencies batch27 — observation vs trusted, missing registry, reports", () => {
  it("returns empty views for unknown skill ids", () => {
    const database = freshDb();
    const view = getSkillDependencyView(database, 999_999);
    expect(view.trusted).toEqual([]);
    expect(view.observed).toEqual([]);
    expect(getReverseDependencyView(database, 999_999)).toEqual([]);
  });

  it("classifies agent_skill_reports as observation-only non-trusted provenance", () => {
    const database = freshDb();
    const skillName = `report-${randomUUID().slice(0, 6)}`;
    const { id: skillId } = insertSkill(database, skillName);
    database.prepare(
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES ('agent-b27', 'Rep', 'agent', 'memroos', 'local')`,
    ).run();
    database
      .prepare(
        `INSERT INTO agent_skill_reports (agent_id, skill_id, action, metadata, reported_at)
         VALUES ('agent-b27', ?, 'used', '{}', datetime('now'))`,
      )
      .run(String(skillId));
    const view = getSkillDependencyView(database, skillId);
    const report = view.observed.find((row) => row.provenance === "report");
    expect(report?.is_trusted).toBe(false);
    expect(report?.is_observation).toBe(true);
    expect(view.trusted.some((row) => row.provenance === "report")).toBe(false);
  });

  it("marks marketplace listings as trusted marketplace provenance", () => {
    const database = freshDb();
    const skillName = `mkt-${randomUUID().slice(0, 6)}`;
    const { id: skillId } = insertSkill(database, skillName);
    const ts = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO skill_marketplace
           (id, skill_id, name, description, author, version, category, published_at, updated_at, deprecated)
         VALUES (?, ?, ?, 'desc', 'author', '1.0.0', 'testing', ?, ?, 0)`,
      )
      .run(`mkt-${randomUUID()}`, String(skillId), skillName, ts, ts);
    const view = getSkillDependencyView(database, skillId);
    expect(view.trusted.some((row) => row.provenance === "marketplace" && row.is_trusted === true)).toBe(true);
  });
});
