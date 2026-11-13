// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildGsdResume,
  buildGsdStandup,
  createOrResumeGsdGoal,
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

describe("agent-gsd-control batch35 — standup scoping, resume handoff, stringArray", () => {
  it("buildGsdStandup without goalId lists active goals (444, 459)", () => {
    const database = freshDb();
    createOrResumeGsdGoal(database, {
      title: `standup-all-b35-${randomUUID().slice(0, 6)}`,
      actorAgentId: "codex-cli-agent",
      lane: "ops",
    });
    const standup = buildGsdStandup(database, { actorAgentId: "codex-cli-agent", limit: 5 });
    expect(standup.activeGoals.length).toBeGreaterThan(0);
    expect(standup.blockers.length).toBeGreaterThanOrEqual(0);
  });

  it("buildGsdResume includes handoff when pack exists (397-398)", () => {
    const database = freshDb();
    const goal = createOrResumeGsdGoal(database, {
      title: `resume-handoff-b35-${randomUUID().slice(0, 6)}`,
      actorAgentId: "codex-cli-agent",
      lane: "code",
    });
    database.prepare(
      `INSERT INTO agent_handoff_packs
         (id, tenant_id, task_id, title, context_pack_json, created_at)
       VALUES (?, 'default-tenant', ?, 'handoff-b35', ?, datetime('now'))`,
    ).run(randomUUID(), goal.goalId, JSON.stringify({ resumeMarker: "resume-marker-b35" }));
    const resume = buildGsdResume(database, {
      goalId: goal.goalId,
      actorAgentId: "codex-cli-agent",
      lane: "code",
    });
    expect(resume.resume.handoff).toBe("resume-marker-b35");
  });

  it("buildGsdStandup maps blockers and approvals from artifacts (459-489)", () => {
    const database = freshDb();
    const goal = createOrResumeGsdGoal(database, {
      title: `standup-proof-b35-${randomUUID().slice(0, 6)}`,
      actorAgentId: "codex-cli-agent",
      lane: "code",
    });
    database.prepare(
      `INSERT INTO hive_actions (agent_id, action_type, summary, artifacts, timestamp)
       VALUES ('codex-cli-agent', 'error', 'blocked batch35 missing proof', ?, datetime('now')),
              ('codex-cli-agent', 'checkpoint', 'shipcheck batch35', ?, datetime('now'))`,
    ).run(
      JSON.stringify({ goalId: goal.goalId, lane: "code" }),
      JSON.stringify({ goalId: goal.goalId, command: "shipcheck", status: "passed", lane: "code" }),
    );
    database.prepare(
      `INSERT INTO audit_entries
         (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, created_at)
       VALUES ('default-tenant', 'op', 'operator', 'gsd.approval', 'gsd_goal', ?, 'approval pending batch35', datetime('now'))`,
    ).run(`gsd_goal:${goal.goalId}`);
    const standup = buildGsdStandup(database, {
      actorAgentId: "codex-cli-agent",
      goalId: goal.goalId,
      limit: 20,
    });
    expect(standup.blockers.some((b) => /blocked batch35/i.test(b.summary))).toBe(true);
    expect(standup.recentProof.some((p) => /shipcheck batch35/i.test(p.summary))).toBe(true);
    expect(standup.pendingApprovals.length).toBeGreaterThan(0);
  });
});
