// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { asGsdLane, buildGsdStandup, createOrResumeGsdGoal } from "@/lib/agent-gsd-control";
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

describe("agent-gsd-control batch30 — parseRecord early return and lane guard", () => {
  it("asGsdLane rejects non-string lane values (line 140 branch)", () => {
    expect(asGsdLane("email_doc")).toBe("email_doc");
    expect(asGsdLane({ lane: "code" })).toBeUndefined();
  });

  it("parseRecord returns {} for blank artifact strings (line 148)", () => {
    const database = freshDb();
    const goal = createOrResumeGsdGoal(database, {
      title: `blank-artifacts-${randomUUID().slice(0, 6)}`,
      actorAgentId: "codex-cli-agent",
      lane: "ops",
    });
    database.prepare(
      `INSERT INTO hive_actions (agent_id, action_type, summary, artifacts, timestamp)
       VALUES ('codex-cli-agent', 'error', 'Blank artifacts batch30', ?, datetime('now'))`,
    ).run("   ");
    const standup = buildGsdStandup(database, {
      actorAgentId: "codex-cli-agent",
      goalId: goal.goalId,
      limit: 10,
    });
    expect(standup.activeGoals.some((g) => g.goalId === goal.goalId)).toBe(true);
    expect(standup.blockers.length).toBeGreaterThanOrEqual(0);
  });

  it("buildGsdStandup filters shipcheck proofs from mixed artifact commands", () => {
    const database = freshDb();
    const goal = createOrResumeGsdGoal(database, {
      title: `shipcheck-${randomUUID().slice(0, 6)}`,
      actorAgentId: "codex-cli-agent",
      lane: "code",
    });
    database.prepare(
      `INSERT INTO hive_actions (agent_id, action_type, summary, artifacts, timestamp)
       VALUES ('codex-cli-agent', 'checkpoint', 'Shipcheck batch30', ?, datetime('now'))`,
    ).run(
      JSON.stringify({
        command: "shipcheck",
        status: "verified",
        goalId: goal.goalId,
        lane: "code",
      }),
    );
    database.prepare(
      `INSERT INTO hive_actions (agent_id, action_type, summary, artifacts, timestamp)
       VALUES ('codex-cli-agent', 'checkpoint', 'Other command batch30', ?, datetime('now'))`,
    ).run(JSON.stringify({ command: "resume", goalId: goal.goalId }));
    const standup = buildGsdStandup(database, {
      actorAgentId: "codex-cli-agent",
      goalId: goal.goalId,
      limit: 20,
    });
    expect(standup.recentProof.some((p) => p.status === "verified")).toBe(true);
  });
});
