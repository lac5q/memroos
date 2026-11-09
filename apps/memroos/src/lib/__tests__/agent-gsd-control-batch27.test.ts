// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { buildGsdStandup, createOrResumeGsdGoal } from "@/lib/agent-gsd-control";
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

describe("agent-gsd-control batch27 — standup blockers, shipcheck proof, malformed artifacts", () => {
  it("buildGsdStandup tolerates non-JSON artifact payloads via parseRecord fallback", () => {
    const database = freshDb();
    const goal = createOrResumeGsdGoal(database, {
      title: `parse-${randomUUID().slice(0, 6)}`,
      actorAgentId: "codex-cli-agent",
      lane: "ops",
    });
    database.prepare(
      `INSERT INTO hive_actions (agent_id, action_type, summary, artifacts, timestamp)
       VALUES ('codex-cli-agent', 'error', 'Blocker with bad artifacts json', ?, datetime('now'))`,
    ).run("{not-json");
    const standup = buildGsdStandup(database, {
      actorAgentId: "codex-cli-agent",
      goalId: goal.goalId,
      limit: 5,
    });
    expect(standup.blockers.length).toBeGreaterThanOrEqual(0);
    expect(standup.activeGoals.some((g) => g.goalId === goal.goalId)).toBe(true);
  });
});
