// @vitest-environment node
import crypto from "crypto";
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

afterEach(() => {
  db?.close();
  db = null;
});

describe("skill-dependencies batch22d — pin fallbacks and reverse view", () => {
  it("getSkillDependencyView loads legacy pins by skill_name when skill_id is null", () => {
    const database = freshDb();
    const skillName = `dep-b22d-${crypto.randomUUID().slice(0, 6)}`;
    const body = `body-${crypto.randomUUID().slice(0, 6)}`;
    const skillId = Number(
      database
        .prepare(
          `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
            version, preconditions, allowed_tools, verification_checks, rollback_behavior,
            raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
            evidence_examples, content_hash, trust_level)
           VALUES (?, '', 'ops', 'memroos', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
        )
        .run(skillName, body, new Date().toISOString(), crypto.createHash("sha256").update(body).digest("hex"))
        .lastInsertRowid,
    );
    database.prepare(
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES ('agent-pin-b22d', 'Pin', 'agent', 'memroos', 'local')`,
    ).run();
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO skill_version_pins (agent_id, skill_name, current_version, current_content_hash, actor, created_at, updated_at)
         VALUES ('agent-pin-b22d', ?, '1.0.0', ?, 'operator', ?, ?)`,
      )
      .run(skillName, "a".repeat(64), now, now);

    const view = getSkillDependencyView(database, skillId);
    expect(view.trusted.some((row) => row.provenance === "pin")).toBe(true);
  });

  it("getReverseDependencyView lists dependent skills referenced in preconditions", () => {
    const database = freshDb();
    const skillName = `upstream-${crypto.randomUUID().slice(0, 6)}`;
    const body = "upstream body";
    const skillId = Number(
      database
        .prepare(
          `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
            version, preconditions, allowed_tools, verification_checks, rollback_behavior,
            raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
            evidence_examples, content_hash, trust_level)
           VALUES (?, '', 'ops', 'memroos', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
        )
        .run(skillName, body, new Date().toISOString(), crypto.createHash("sha256").update(body).digest("hex"))
        .lastInsertRowid,
    );
    const dependentName = `downstream-${crypto.randomUUID().slice(0, 6)}`;
    database
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level)
         VALUES (?, '', 'ops', 'memroos', 'low', 'enabled', '1.0.0', ?, '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
      )
      .run(
        dependentName,
        `requires skill ${skillName}`,
        "downstream body",
        new Date().toISOString(),
        crypto.createHash("sha256").update("downstream body").digest("hex"),
      );

    const reverse = getReverseDependencyView(database, skillId);
    expect(reverse.some((row) => row.dependent_kind === "skill")).toBe(true);
  });
});
