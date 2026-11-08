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

describe("agent-gsd-control batch31 — resume handoff and standup blockers", () => {
  it("buildGsdResume surfaces handoff marker from ledger", () => {
    const database = freshDb();
    const goal = createOrResumeGsdGoal(database, {
      title: `resume-b31-${randomUUID().slice(0, 6)}`,
      actorAgentId: "codex-cli-agent",
      lane: "ops",
    });
    database.prepare(
      `INSERT INTO agent_handoff_packs
         (id, tenant_id, task_id, title, context_pack_json, created_at)
       VALUES (?, 'default-tenant', ?, 'handoff', ?, datetime('now'))`,
    ).run(randomUUID(), goal.goalId, JSON.stringify({ resumeMarker: "marker-b31", next_action: "standup" }));
    const resume = buildGsdResume(database, {
      goalId: goal.goalId,
      actorAgentId: "codex-cli-agent",
      lane: "ops",
    });
    expect(resume.resume.handoff).toBe("marker-b31");
    expect(resume.resume.nextAction).toBeTruthy();
  });

  it("buildGsdStandup collects blocker errors and pending approval audits", () => {
    const database = freshDb();
    const goal = createOrResumeGsdGoal(database, {
      title: `standup-b31-${randomUUID().slice(0, 6)}`,
      actorAgentId: "codex-cli-agent",
      lane: "code",
    });
    database.prepare(
      `INSERT INTO hive_actions (agent_id, action_type, summary, artifacts, timestamp)
       VALUES ('codex-cli-agent', 'error', 'Blocked batch31 missing proof', ?, datetime('now'))`,
    ).run(JSON.stringify({ goalId: goal.goalId }));
    database.prepare(
      `INSERT INTO audit_entries
         (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, created_at)
       VALUES (?, 'default-tenant', 'op', 'operator', 'hil', 'task', ?, 'Awaiting approval batch31', datetime('now'))`,
    ).run(`audit-${randomUUID().slice(0, 8)}`, goal.goalId);
    const standup = buildGsdStandup(database, {
      actorAgentId: "codex-cli-agent",
      goalId: goal.goalId,
      limit: 10,
    });
    expect(standup.blockers.some((b) => /Blocked batch31/i.test(b.summary))).toBe(true);
    expect(standup.pendingApprovals.some((a) => /approval/i.test(a.reason ?? ""))).toBe(true);
  });
});
