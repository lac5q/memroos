// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";

function insertSkill(db: Database.Database, lifecycle = "enabled"): number {
  const body = `skill-body-${crypto.randomUUID().slice(0, 6)}`;
  return Number(
    db
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level, lifecycle_state)
         VALUES (?, '', 'ops', 'claude', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned', ?)`,
      )
      .run(
        `skill-b19-${crypto.randomUUID().slice(0, 6)}`,
        body,
        new Date().toISOString(),
        crypto.createHash("sha256").update(body).digest("hex"),
        lifecycle,
      )
      .lastInsertRowid,
  );
}

describe("skill-lifecycle batch19 — dependencies and NOC levels", () => {
  it("addSkillDependency upserts and removeSkillDependency deletes rows", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertSkill(db);
    const { addSkillDependency, removeSkillDependency, getDependents, LifecycleTransitionError } = await import(
      "../skill-lifecycle"
    );
    const agentId = `agent-${crypto.randomUUID().slice(0, 6)}`;
    const row = addSkillDependency(db, {
      skillId,
      dependentAgentId: agentId,
      skillVersion: "1.0.0",
      registeredBy: "operator",
    });
    expect(row.skill_id).toBe(skillId);
    addSkillDependency(db, {
      skillId,
      dependentAgentId: agentId,
      skillVersion: "2.0.0",
      registeredBy: "operator",
    });
    expect(getDependents(db, skillId)[0]?.skill_version).toBe("2.0.0");
    expect(removeSkillDependency(db, skillId, agentId)).toBe(true);
    expect(removeSkillDependency(db, skillId, agentId)).toBe(false);
    expect(() =>
      addSkillDependency(db, {
        skillId: -1,
        dependentAgentId: agentId,
        skillVersion: "1.0.0",
        registeredBy: "operator",
      }),
    ).toThrow(LifecycleTransitionError);
    db.close();
  });

  it("listDeprecatedSkills derives warning levels from dependent counts", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertSkill(db, "deprecated");
    db.prepare(
      `INSERT INTO skill_lifecycle_audit (skill_id, from_state, to_state, actor, reason, transitioned_at)
       VALUES (?, 'enabled', 'deprecated', 'operator', 'sunset', ?)`,
    ).run(skillId, new Date().toISOString());
    for (let i = 0; i < 5; i += 1) {
      db.prepare(
        `INSERT INTO skill_dependencies (skill_id, dependent_agent_id, skill_version, registered_by, created_at, updated_at)
         VALUES (?, ?, '1.0.0', 'operator', ?, ?)`,
      ).run(skillId, `dep-${i}`, new Date().toISOString(), new Date().toISOString());
    }
    const { listDeprecatedSkills } = await import("../skill-lifecycle");
    const entries = listDeprecatedSkills(db, { limit: 10 });
    const entry = entries.find((item) => item.skill_id === skillId);
    expect(entry?.warning_level).toBe("critical");
    db.close();
  });
});
