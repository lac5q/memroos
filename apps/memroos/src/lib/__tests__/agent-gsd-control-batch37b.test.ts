// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { buildGsdStandup, createOrResumeGsdGoal } from "@/lib/agent-gsd-control";
import { initSchema } from "@/lib/db-schema";

let db: Database.Database | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

describe("agent-gsd-control batch37b — standup scoped goal", () => {
  it("buildGsdStandup with goalId scopes active goals and approvals (444)", () => {
    db = new Database(":memory:");
    initSchema(db);
    const goal = createOrResumeGsdGoal(db, {
      title: `scoped-b37b-${randomUUID().slice(0, 6)}`,
      actorAgentId: "codex-cli-agent",
      lane: "code",
    });
    createOrResumeGsdGoal(db, {
      title: `other-b37b-${randomUUID().slice(0, 6)}`,
      actorAgentId: "codex-cli-agent",
      lane: "ops",
    });
    db.prepare(
      `INSERT INTO audit_entries
         (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, created_at)
       VALUES ('default-tenant', 'op', 'operator', 'gsd.approval', 'gsd_goal', ?, 'approval pending batch37b', datetime('now'))`,
    ).run(`gsd_goal:${goal.goalId}`);
    const standup = buildGsdStandup(db, { goalId: goal.goalId, actorAgentId: "codex-cli-agent" });
    expect(standup.activeGoals.every((g) => g.goalId === goal.goalId)).toBe(true);
    expect(standup.pendingApprovals.some((a) => /approval pending batch37b/i.test(a.reason ?? ""))).toBe(true);
  });
});