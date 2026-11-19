// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildGsdResume,
  buildGsdStandup,
  createOrResumeGsdGoal,
  runGsdShipcheck,
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

describe("agent-gsd-control batch26 — resume nextAction, standup scope, bypass proof", () => {
  it("buildGsdResume prefers verification requiredProof when no handoff exists", () => {
    const database = freshDb();
    const goal = createOrResumeGsdGoal(database, {
      title: `resume-${randomUUID().slice(0, 6)}`,
      actorAgentId: "codex-cli-agent",
      lane: "code",
    });
    database.prepare(
      `INSERT INTO agent_checkpoints
         (id, tenant_id, run_id, owner_agent_id, objective, completed_steps_json, remaining_steps_json,
          decisions_json, artifact_refs_json, verification_state_json, next_safe_action, rollback_notes,
          provenance_pointers_json, checkpoint_size, write_latency_ms, created_at)
       VALUES (?, 'default-tenant', ?, 'codex-cli-agent', 'Verify', '[]', '[]', '{}', '[]', ?, 'continue', NULL, '[]', 1, 1, datetime('now'))`,
    ).run(randomUUID(), goal.goalId, JSON.stringify({ focused_tests: "pending" }));
    const resume = buildGsdResume(database, {
      goalId: goal.goalId,
      actorAgentId: "codex-cli-agent",
      lane: "code",
    });
    expect(resume.resume.nextAction).toBe("focused_tests");
    expect(resume.resume.handoff).toBeUndefined();
  });

  it("buildGsdStandup without goalId lists active delegations only", () => {
    const database = freshDb();
    database.prepare(
      `INSERT INTO hive_delegations
         (task_id, from_agent, to_agent, task_summary, status, created_at, updated_at)
       VALUES ('active-b26', 'director', 'worker', 'Active goal', 'active', datetime('now'), datetime('now'))`,
    ).run();
    database.prepare(
      `INSERT INTO hive_delegations
         (task_id, from_agent, to_agent, task_summary, status, created_at, updated_at)
       VALUES ('done-b26', 'director', 'worker', 'Completed goal', 'completed', datetime('now'), datetime('now'))`,
    ).run();
    const standup = buildGsdStandup(database, { actorAgentId: "codex-cli-agent", limit: 10 });
    expect(standup.activeGoals.some((g) => g.goalId === "active-b26")).toBe(true);
    expect(standup.activeGoals.some((g) => g.goalId === "done-b26")).toBe(false);
  });

  it("runGsdShipcheck verified when bypassReason is provided without proof", () => {
    const database = freshDb();
    const goal = createOrResumeGsdGoal(database, {
      title: `bypass-${randomUUID().slice(0, 6)}`,
      actorAgentId: "codex-cli-agent",
      lane: "ops",
    });
    const result = runGsdShipcheck(database, {
      goalId: goal.goalId,
      actorAgentId: "codex-cli-agent",
      lane: "ops",
      proof: {},
      bypassReason: "operator waived proof for batch26",
    });
    expect(result.status).toBe("bypassed");
    expect(result.bypassReason).toMatch(/waived proof/);
  });

  it("buildGsdStandup parses string artifacts via parseRecord for scoped blockers", () => {
    const database = freshDb();
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    database.prepare(
      `INSERT INTO hive_actions (agent_id, action_type, summary, artifacts, timestamp)
       VALUES ('codex-cli-agent', 'error', 'Blocked on missing proof', ?, datetime('now'))`,
    ).run(JSON.stringify({ goalId, lane: "code" }));
    const standup = buildGsdStandup(database, { actorAgentId: "codex-cli-agent", goalId, limit: 10 });
    expect(standup.blockers.some((b) => b.goalId === goalId)).toBe(true);
  });
});
