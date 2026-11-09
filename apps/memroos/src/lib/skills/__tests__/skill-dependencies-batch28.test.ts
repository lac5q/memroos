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

function insertSkill(database: Database.Database, name: string, preconditions = ""): number {
  const body = `body-${name}`;
  const hash = createHash("sha256").update(body).digest("hex");
  return Number(
    database
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
            version, preconditions, allowed_tools, verification_checks, rollback_behavior,
            raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
            evidence_examples, content_hash, trust_level, lifecycle_state)
           VALUES (?, '', 'ops', 'memroos', 'low', 'enabled', '1.0.0', ?, '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned', 'enabled')`,
      )
      .run(name, preconditions, body, new Date().toISOString(), hash)
      .lastInsertRowid,
  );
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("skill-dependencies batch28 — reverse config dependents and forward consistency", () => {
  it("getReverseDependencyView lists skill dependents referenced in preconditions", () => {
    const database = freshDb();
    const baseName = `base-${randomUUID().slice(0, 6)}`;
    const baseId = insertSkill(database, baseName);
    const dependentName = `dep-${randomUUID().slice(0, 6)}`;
    insertSkill(database, dependentName, `requires skill ${baseName} before dispatch`);

    const reverse = getReverseDependencyView(database, baseId);
    expect(reverse.some((row) => row.dependent_kind === "skill" && row.via === "config")).toBe(true);
  });

  it("getSkillDependencyView forward_consistency reports ok for isolated skill", () => {
    const database = freshDb();
    const skillId = insertSkill(database, `solo-${randomUUID().slice(0, 6)}`);
    const view = getSkillDependencyView(database, skillId);
    expect(view.forward_consistency.ok).toBe(true);
    expect(view.forward_consistency.mismatches).toEqual([]);
  });
});
