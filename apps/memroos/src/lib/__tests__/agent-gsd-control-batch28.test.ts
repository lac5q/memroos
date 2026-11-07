// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { buildGsdResume, buildGsdStandup, createOrResumeGsdGoal } from "@/lib/agent-gsd-control";
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

describe("agent-gsd-control batch28 — shipcheck proof filter and resume packet", () => {
  it("buildGsdStandup surfaces recent shipcheck proof actions", () => {
    const database = freshDb();
    const goal = createOrResumeGsdGoal(database, {
      title: `ship-${randomUUID().slice(0, 6)}`,
      actorAgentId: "codex-cli-agent",
      lane: "code",
    });
    database.prepare(
      `INSERT INTO hive_actions (agent_id, action_type, summary, artifacts, timestamp)
       VALUES ('codex-cli-agent', 'checkpoint', 'Shipcheck verified batch28', ?, datetime('now'))`,
    ).run(
      JSON.stringify({
        command: "shipcheck",
        status: "verified",
        goalId: goal.goalId,
        lane: "code",
      }),
    );
    const standup = buildGsdStandup(database, {
      actorAgentId: "codex-cli-agent",
      goalId: goal.goalId,
      limit: 10,
    });
    expect(standup.recentProof.some((p) => p.status === "verified")).toBe(true);
  });

  it("buildGsdResume returns resume nextAction from ledger handoffs when present", () => {
    const database = freshDb();
    const goal = createOrResumeGsdGoal(database, {
      title: `resume-${randomUUID().slice(0, 6)}`,
      actorAgentId: "codex-cli-agent",
      lane: "ops",
    });
    database.prepare(
      `INSERT INTO agent_checkpoints
         (id, tenant_id, run_id, owner_agent_id, objective, completed_steps_json, remaining_steps_json,
          decisions_json, artifact_refs_json, verification_state_json, next_safe_action, rollback_notes,
          provenance_pointers_json, checkpoint_size, write_latency_ms, created_at)
       VALUES (?, 'default-tenant', ?, 'codex-cli-agent', 'Resume batch28', '[]', '[]', '{}', '[]', '{}', ?, NULL, '[]', 1, 1, datetime('now'))`,
    ).run(randomUUID(), goal.goalId, "Continue with shipcheck");
    const resume = buildGsdResume(database, {
      goalId: goal.goalId,
      actorAgentId: "codex-cli-agent",
      lane: "ops",
    });
    expect(resume.resume.nextAction).toBeTruthy();
    expect(resume.packet.goal.id).toBe(goal.goalId);
  });
});
