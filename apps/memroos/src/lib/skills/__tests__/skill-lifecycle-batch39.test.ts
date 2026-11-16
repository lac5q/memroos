// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { initSchema } from "@/lib/db-schema";
import {
  LifecycleTransitionError,
  transitionLifecycleState,
} from "../skill-lifecycle";

describe("skill-lifecycle batch39 — loadLifecycleState invalid enum (407)", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("transitionLifecycleState treats invalid lifecycle_state as missing skill (407)", () => {
    const now = new Date().toISOString();
    const name = `skill-b39-${randomUUID().slice(0, 8)}`;
    const insert = db
      .prepare(
        `INSERT INTO skill_registry (
          name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          lifecycle_state
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        name,
        "batch39 lifecycle",
        "ops",
        "codex",
        "low",
        "enabled",
        "1.0.0",
        "none",
        "read_file",
        "verify",
        "revert",
        "## body",
        100,
        "[]",
        "operator",
        now,
        "draft",
      );
    const skillId = Number(insert.lastInsertRowid);

    db.pragma("ignore_check_constraints = ON");
    db.prepare(`UPDATE skill_registry SET lifecycle_state = ? WHERE id = ?`).run(
      "not_a_real_lifecycle_state_b39",
      skillId,
    );
    db.pragma("ignore_check_constraints = OFF");

    const row = db
      .prepare(`SELECT lifecycle_state FROM skill_registry WHERE id = ?`)
      .get(skillId) as { lifecycle_state: string };
    expect(row.lifecycle_state).toBe("not_a_real_lifecycle_state_b39");

    expect(() =>
      transitionLifecycleState(db, skillId, "enabled", "operator-b39", "enable after bad enum"),
    ).toThrow(LifecycleTransitionError);

    try {
      transitionLifecycleState(db, skillId, "enabled", "operator-b39", "enable after bad enum");
    } catch (error) {
      expect(error).toBeInstanceOf(LifecycleTransitionError);
      expect((error as LifecycleTransitionError).message).toMatch(/invalid/i);
    }
  });
});