// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { initSchema } from "@/lib/db-schema";
import { auditRegisteredSkills } from "../skill-boundary";

describe("gsd skill-boundary batch33", () => {
  it("daysSince treats invalid imported_at as stale (97)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `skill-b33-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO skill_registry (name, owner, source_harness, verification_checks, imported_at, imported_by, raw_body, dispatch_status)
       VALUES (?, 'ops', 'cursor', 'smoke', 'not-a-date', 'operator', '# Skill', 'enabled')`,
    ).run(name);
    const result = auditRegisteredSkills(db, { now: () => new Date("2026-11-10T00:00:00.000Z") });
    expect(result.findings.some((f) => f.code === "stale_review_date" && f.skillName === name)).toBe(true);
    db.close();
  });

  it("hasUsageEvidence returns true when hive_actions references skill (113)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `skill-hive-b33-${randomUUID().slice(0, 8)}`;
    const rawBody = ["## Usage", "", "```", "example", "```"].join("\n");
    db.prepare(
      `INSERT INTO skill_registry (name, owner, source_harness, verification_checks, imported_at, imported_by, raw_body, dispatch_status)
       VALUES (?, 'ops', 'cursor', 'smoke', '2026-11-01T00:00:00.000Z', 'operator', ?, 'enabled')`,
    ).run(name, rawBody);
    db.prepare(
      `INSERT INTO hive_actions (agent_id, action_type, summary, artifacts)
       VALUES ('agent-b33', 'continue', ?, '[]')`,
    ).run(`Ran ${name} in batch33`);
    const result = auditRegisteredSkills(db);
    expect(result.findings.some((f) => f.code === "no_usage_evidence" && f.skillName === name)).toBe(false);
    db.close();
  });
});
