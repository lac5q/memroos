// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  asGsdLane,
  buildGsdResume,
  buildGsdStandup,
  createOrResumeGsdGoal,
  gsdInputFromJson,
  gsdStringArray,
} from "@/lib/agent-gsd-control";
import { initSchema } from "@/lib/db-schema";

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

describe("agent-gsd-control batch34 — lane guard, standup filters, resume handoff", () => {
  it("asGsdLane accepts known lanes and rejects unknown values (151)", () => {
    expect(asGsdLane("ops")).toBe("ops");
    expect(asGsdLane("not-a-lane")).toBeUndefined();
  });

  it("buildGsdResume omits handoff key when no pack exists (397)", () => {
    const database = freshDb();
    const goal = createOrResumeGsdGoal(database, {
      title: `resume-no-handoff-b34-${randomUUID().slice(0, 6)}`,
      actorAgentId: "codex-cli-agent",
      lane: "ops",
    });
    const resume = buildGsdResume(database, {
      goalId: goal.goalId,
      actorAgentId: "codex-cli-agent",
      lane: "ops",
    });
    expect(resume.resume.handoff).toBeUndefined();
    expect(resume.resume.nextAction).toBeTruthy();
  });

  it("buildGsdStandup scopes actions by goalId and collects shipcheck proof (443-480)", () => {
    const database = freshDb();
    const goal = createOrResumeGsdGoal(database, {
      title: `standup-b34-${randomUUID().slice(0, 6)}`,
      actorAgentId: "codex-cli-agent",
      lane: "code",
    });
    const otherGoal = createOrResumeGsdGoal(database, {
      title: `other-b34-${randomUUID().slice(0, 6)}`,
      actorAgentId: "codex-cli-agent",
      lane: "code",
    });
    database.prepare(
      `INSERT INTO hive_actions (agent_id, action_type, summary, artifacts, timestamp)
       VALUES ('codex-cli-agent', 'checkpoint', 'shipcheck batch34', ?, datetime('now')),
              ('codex-cli-agent', 'error', 'blocked batch34 missing proof', ?, datetime('now'))`,
    ).run(
      JSON.stringify({ goalId: goal.goalId, command: "shipcheck", status: "passed", lane: "code" }),
      JSON.stringify({ goalId: otherGoal.goalId, command: "lint" }),
    );
    const standup = buildGsdStandup(database, {
      actorAgentId: "codex-cli-agent",
      goalId: goal.goalId,
      limit: 20,
    });
    expect(standup.recentProof.some((p) => /shipcheck/i.test(p.summary))).toBe(true);
    expect(standup.recentProof.every((p) => !p.goalId || p.goalId === goal.goalId)).toBe(true);
    expect(standup.blockers.some((b) => /blocked batch34/i.test(b.summary))).toBe(false);
  });

  it("gsdInputFromJson and gsdStringArray coerce non-object inputs (499-504)", () => {
    expect(gsdInputFromJson(null)).toEqual({});
    expect(gsdInputFromJson(["not", "object"])).toEqual({});
    expect(gsdStringArray(["  ", "lane-b34", 42, "ops"])).toEqual(["lane-b34", "ops"]);
  });
});
