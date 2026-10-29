// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  asGsdLane,
  buildGsdStandup,
  createOrResumeGsdGoal,
  gsdInputFromJson,
  gsdStringArray,
  runGsdShipcheck,
} from "@/lib/agent-gsd-control";
import { initSchema } from "@/lib/db-schema";

function seedDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  db.prepare(
    `INSERT INTO registered_agents(id, name, role, platform, protocol, status)
     VALUES('agent-alpha', 'Agent Alpha', 'Worker', 'codex', 'rest', 'active')`,
  ).run();
  return db;
}

describe("agent-gsd-control batch16 — lane parsing and standup blockers", () => {
  it("asGsdLane and gsd helpers normalize unknown inputs", () => {
    expect(asGsdLane("code")).toBe("code");
    expect(asGsdLane("not-a-lane")).toBeUndefined();
    expect(gsdInputFromJson(null)).toEqual({});
    expect(gsdStringArray(["a", "", 3, "b"])).toEqual(["a", "b"]);
  });

  it("runGsdShipcheck requires goalId and actorAgentId", () => {
    const db = seedDb();
    expect(() => runGsdShipcheck(db, { goalId: " ", actorAgentId: "agent-alpha" })).toThrow(/goalId/);
    expect(() => runGsdShipcheck(db, { goalId: "goal-1", actorAgentId: " " })).toThrow(/actorAgentId/);
    db.close();
  });

  it("buildGsdStandup scopes blockers and recent proof to a goal", () => {
    const db = seedDb();
    const goalA = "goal-a";
    const goalB = "goal-b";
    createOrResumeGsdGoal(db, { goalId: goalA, title: "Goal A", actorAgentId: "agent-alpha", lane: "ops" });
    createOrResumeGsdGoal(db, { goalId: goalB, title: "Goal B", actorAgentId: "agent-alpha", lane: "ops" });

    db.prepare(
      `INSERT INTO hive_actions(agent_id, action_type, summary, artifacts, timestamp)
       VALUES ('agent-alpha', 'error', 'blocked on missing proof', ?, '2026-06-01T00:00:00.000Z')`,
    ).run(JSON.stringify({ goalId: goalA, command: "shipcheck", status: "blocked" }));
    db.prepare(
      `INSERT INTO hive_actions(agent_id, action_type, summary, artifacts, timestamp)
       VALUES ('agent-alpha', 'checkpoint', 'other goal proof', ?, '2026-06-01T00:00:01.000Z')`,
    ).run(JSON.stringify({ goalId: goalB, command: "shipcheck", status: "verified" }));

    const standup = buildGsdStandup(db, { actorAgentId: "agent-alpha", goalId: goalA, limit: 10 });
    expect(standup.blockers.some((b) => b.summary.includes("blocked"))).toBe(true);
    expect(standup.recentProof.every((p) => p.goalId === goalA)).toBe(true);
    db.close();
  });
});
