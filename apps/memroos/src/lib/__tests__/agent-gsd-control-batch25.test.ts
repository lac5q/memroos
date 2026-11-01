// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  asGsdLane,
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

describe("agent-gsd-control batch25 — validation, receipts, standup scope", () => {
  it("asGsdLane accepts known lanes and rejects unknown values", () => {
    expect(asGsdLane("code")).toBe("code");
    expect(asGsdLane("not-a-lane")).toBeUndefined();
    expect(asGsdLane(42)).toBeUndefined();
  });

  it("createOrResumeGsdGoal requires title and actorAgentId", () => {
    const database = freshDb();
    expect(() =>
      createOrResumeGsdGoal(database, {
        title: "   ",
        actorAgentId: "codex-cli-agent",
      }),
    ).toThrow(/goal title is required/);
    expect(() =>
      createOrResumeGsdGoal(database, {
        title: "Valid",
        actorAgentId: "",
      }),
    ).toThrow(/actorAgentId is required/);
  });

  it("runGsdShipcheck honors proof.receipts and defaults lane to ops", () => {
    const database = freshDb();
    const goal = createOrResumeGsdGoal(database, {
      title: `receipts-${randomUUID().slice(0, 6)}`,
      actorAgentId: "codex-cli-agent",
      lane: "ops",
    });
    const verified = runGsdShipcheck(database, {
      goalId: goal.goalId,
      actorAgentId: "codex-cli-agent",
      proof: { receipts: ["operator_receipt"] },
    });
    expect(verified.status).toBe("verified");
    expect(verified.lane).toBe("ops");
  });

  it("runGsdShipcheck blocks when proof is missing and no bypass reason", () => {
    const database = freshDb();
    const goal = createOrResumeGsdGoal(database, {
      title: `blocked-${randomUUID().slice(0, 6)}`,
      actorAgentId: "codex-cli-agent",
      lane: "code",
    });
    const blocked = runGsdShipcheck(database, {
      goalId: goal.goalId,
      actorAgentId: "codex-cli-agent",
      lane: "code",
      proof: {},
    });
    expect(blocked.status).toBe("blocked");
    expect(blocked.missingProof).toContain("focused_tests");
  });

  it("buildGsdResume includes handoff marker when a handoff pack exists", () => {
    const database = freshDb();
    const goal = createOrResumeGsdGoal(database, {
      title: `handoff-${randomUUID().slice(0, 6)}`,
      actorAgentId: "codex-cli-agent",
      lane: "ops",
    });
    database.prepare(
      `INSERT INTO agent_handoff_packs
         (id, tenant_id, from_agent_id, to_agent_id, task_id, title, context_pack_json, source_capture_ids_json)
       VALUES (?, 'default-tenant', 'codex-cli-agent', 'cursor-agent', ?, 'Resume pack', ?, '[]')`,
    ).run(randomUUID(), goal.goalId, JSON.stringify({ summary: "batch25 handoff" }));
    const resume = buildGsdResume(database, {
      goalId: goal.goalId,
      actorAgentId: "codex-cli-agent",
      lane: "ops",
    });
    expect(resume.resume.handoff).toBeTruthy();
  });

  it("buildGsdStandup scopes blockers and proof rows by goal_id alias", () => {
    const database = freshDb();
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    const ts = new Date().toISOString();
    database.prepare(
      `INSERT INTO hive_actions (agent_id, action_type, summary, artifacts, timestamp)
       VALUES ('codex-cli-agent', 'error', 'Goal blocked on proof', ?, ?)`,
    ).run(JSON.stringify({ goal_id: goalId, command: "shipcheck", status: "blocked", lane: "code" }), ts);
    database.prepare(
      `INSERT INTO hive_actions (agent_id, action_type, summary, artifacts, timestamp)
       VALUES ('codex-cli-agent', 'checkpoint', 'Scoped shipcheck', ?, ?)`,
    ).run(JSON.stringify({ goalId, command: "shipcheck", status: "verified", lane: "code" }), ts);
    database.prepare(
      `INSERT INTO hive_actions (agent_id, action_type, summary, artifacts, timestamp)
       VALUES ('codex-cli-agent', 'checkpoint', 'Other goal', ?, ?)`,
    ).run(JSON.stringify({ goal_id: "other-goal", command: "shipcheck" }), ts);
    const standup = buildGsdStandup(database, {
      actorAgentId: "codex-cli-agent",
      goalId,
      limit: 20,
    });
    expect(standup.blockers.some((row) => /blocked/i.test(row.summary))).toBe(true);
    expect(standup.recentProof.filter((row) => row.goalId === goalId)).toHaveLength(1);
    expect(standup.recentProof.find((row) => row.goalId === goalId)?.lane).toBe("code");
  });
});
