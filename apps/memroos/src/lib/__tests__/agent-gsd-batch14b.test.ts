// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  asGsdLane,
  buildGsdResume,
  createOrResumeGsdGoal,
  gsdInputFromJson,
  gsdStringArray,
} from "@/lib/agent-gsd-control";
import { initSchema } from "@/lib/db-schema";

function seedGsdDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  db.prepare(
    `INSERT INTO registered_agents(id, name, role, platform, protocol, status)
     VALUES ('agent-gsd', 'GSD Agent', 'Planner', 'codex', 'rest', 'active')`,
  ).run();
  return db;
}

describe("agent-gsd-control batch14b", () => {
  it("asGsdLane and gsdInputFromJson normalize unknown inputs", () => {
    expect(asGsdLane("ops")).toBe("ops");
    expect(asGsdLane("invalid-lane")).toBeUndefined();
    expect(gsdInputFromJson(null)).toEqual({});
    expect(gsdStringArray([" a ", "", "b"])).toEqual([" a ", "b"]);
  });

  it("createOrResumeGsdGoal requires title and actor", () => {
    const db = seedGsdDb();
    expect(() => createOrResumeGsdGoal(db, { title: "  ", actorAgentId: "agent-gsd" })).toThrow(/title/);
    expect(() => createOrResumeGsdGoal(db, { title: "Ship feature", actorAgentId: "  " })).toThrow(/actorAgentId/);
    db.close();
  });

  it("createOrResumeGsdGoal writes hive delegation row", () => {
    const db = seedGsdDb();
    const now = () => new Date("2026-01-01T00:00:00Z");
    const result = createOrResumeGsdGoal(db, {
      title: `Batch14b goal ${crypto.randomUUID().slice(0, 6)}`,
      actorAgentId: "agent-gsd",
      lane: "ops",
      now,
    });
    expect(result.goalId).toMatch(/^gsd_/);
    const row = db
      .prepare(`SELECT status FROM hive_delegations WHERE task_id = ?`)
      .get(result.goalId) as { status: string } | undefined;
    expect(row?.status).toBe("active");
    db.close();
  });

  it("buildGsdResume returns resume marker from checkpoint", () => {
    const db = seedGsdDb();
    const goal = createOrResumeGsdGoal(db, {
      title: "Resume test",
      actorAgentId: "agent-gsd",
      goalId: "goal-resume-b14b",
      now: () => new Date("2026-01-01T00:00:00Z"),
    });
    const resume = buildGsdResume(db, { goalId: goal.goalId, actorAgentId: "agent-gsd" });
    expect(resume.resume.nextAction).toBeTruthy();
    db.close();
  });
});
