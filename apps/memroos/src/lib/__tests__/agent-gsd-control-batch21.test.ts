// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { buildGsdStandup, createOrResumeGsdGoal, runGsdShipcheck } from "@/lib/agent-gsd-control";
import { initSchema } from "@/lib/db-schema";

const db = new Database(":memory:");
initSchema(db);

afterEach(() => {
  db.prepare("DELETE FROM hive_actions").run();
  // audit_entries is append-only — do not DELETE
  db.prepare("DELETE FROM agent_checkpoints").run();
});

describe("agent-gsd-control batch21 — parseRecord, proof objects, approvals", () => {
  it("runGsdShipcheck accepts object-shaped proof values as truthy", () => {
    const goal = createOrResumeGsdGoal(db, {
      title: "Object proof",
      actorAgentId: "codex-cli-agent",
      lane: "code",
    });
    const verified = runGsdShipcheck(db, {
      goalId: goal.goalId,
      actorAgentId: "codex-cli-agent",
      lane: "code",
      proof: { focused_tests: { exitCode: 0, summary: "green" } },
    });
    expect(verified.status).toBe("verified");
  });

  it("buildGsdStandup surfaces pending approvals and malformed shipcheck artifacts", () => {
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    const ts = new Date().toISOString();
    db.prepare(
      `INSERT INTO hive_actions (agent_id, action_type, summary, artifacts, timestamp)
       VALUES ('codex-cli-agent', 'checkpoint', 'done', ?, ?)`,
    ).run(JSON.stringify({ goalId, command: "shipcheck", status: "verified" }), ts);
    db.prepare(
      `INSERT INTO hive_actions (agent_id, action_type, summary, artifacts, timestamp)
       VALUES ('codex-cli-agent', 'checkpoint', 'bad artifacts', ?, ?)`,
    ).run("{bad-json", ts);
    db.prepare(
      `INSERT INTO audit_entries
         (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
       VALUES (?, 'default-tenant', 'operator', 'operator', 'gsd.approval.pending', 'gsd_goal', ?, 'Needs operator approval', '{}', ?)`,
    ).run(randomUUID(), `gsd_goal:${goalId}`, ts);
    db.prepare(
      `INSERT INTO agent_checkpoints
         (id, tenant_id, run_id, owner_agent_id, objective, next_safe_action, created_at)
       VALUES (?, 'default-tenant', ?, 'codex-cli-agent', 'obj', 'next', ?)`,
    ).run(randomUUID(), goalId, ts);
    const standup = buildGsdStandup(db, {
      actorAgentId: "codex-cli-agent",
      goalId,
      limit: 10,
    });
    expect(standup.pendingApprovals.some((row) => row.goalId === goalId)).toBe(true);
    expect(standup.recentProof.some((row) => row.goalId === goalId)).toBe(true);
    expect(standup.nextActions.some((row) => row.goalId === goalId)).toBe(true);
  });
});
