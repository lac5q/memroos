// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { getSkillDependencyView } from "../skill-dependencies";

describe("skill-dependencies batch21 — safeGet and provenance classes", () => {
  it("getSkillDependencyView reports missing registry rows when skill_registry is absent", () => {
    const db = new Database(":memory:");
    initSchema(db);
    db.exec("DROP TABLE skill_registry");
    const view = getSkillDependencyView(db, 1);
    expect(view.forward_consistency.ok).toBe(false);
    expect(view.forward_consistency.mismatches).toContain("registry row missing");
    expect(view.trusted).toEqual([]);
    expect(view.observed).toEqual([]);
    db.close();
  });

  it("getSkillDependencyView keeps report rows in observed and pins in trusted", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `dep-b21-${crypto.randomUUID().slice(0, 6)}`;
    const body = `body-${crypto.randomUUID().slice(0, 6)}`;
    const skillId = Number(
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
    db.prepare(
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES ('agent-pin-b21', 'Pin', 'agent', 'memroos', 'local')`,
    ).run();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO skill_version_pins (agent_id, skill_name, current_version, current_content_hash, actor, created_at, updated_at)
       VALUES ('agent-pin-b21', ?, '1.0.0', ?, 'operator', ?, ?)`,
    ).run(name, "b".repeat(64), now, now);
    db.prepare(
      `INSERT INTO agent_skill_reports (agent_id, skill_id, action, metadata, reported_at)
       VALUES ('agent-pin-b21', ?, 'observed', '{}', ?)`,
    ).run(String(skillId), now);
    const view = getSkillDependencyView(db, skillId);
    expect(view.trusted.some((row) => row.provenance === "pin")).toBe(true);
    expect(view.observed.some((row) => row.provenance === "report")).toBe(true);
    db.close();
  });
});
