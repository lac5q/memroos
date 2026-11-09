// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB_DIR = path.join(os.tmpdir(), `gsd-adapters-b26-${randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "adapters.db");

async function loadModules() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  vi.resetModules();
  const dbModule = await import("@/lib/db");
  const adapters = await import("@/lib/gsd/adapters");
  return { getDb: dbModule.getDb, closeDb: dbModule.closeDb, ...adapters };
}

const ACTOR = "adapter-b26-agent";
const FIXED_NOW = new Date("2026-11-02T09:00:00.000Z");

describe("GSD adapters batch26 — context, resume, standup, council actions", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  });

  afterEach(async () => {
    const { closeDb } = await loadModules();
    closeDb();
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    delete process.env.SQLITE_DB_PATH;
  });

  it("request_context builds agent context packet for goal_id alias", async () => {
    const { getDb, executeGsdAdapterAction } = await loadModules();
    const db = getDb();
    const goalId = `goal-ctx-${randomUUID().slice(0, 8)}`;
    executeGsdAdapterAction(db, {
      adapterId: "codex",
      actorAgentId: ACTOR,
      action: "create_task",
      payload: { title: "Context path", goalId, lane: "ops" },
      now: () => FIXED_NOW,
    });
    const ctx = executeGsdAdapterAction(db, {
      adapterId: "hermes",
      actorAgentId: ACTOR,
      action: "request_context",
      payload: { goal_id: goalId, lane: "ops" },
      now: () => FIXED_NOW,
    });
    expect(ctx.ok).toBe(true);
    expect(ctx.result).toMatchObject({ packet: { goal: { id: goalId } } });
  });

  it("resume and standup actions return ok results", async () => {
    const { getDb, executeGsdAdapterAction } = await loadModules();
    const db = getDb();
    const goalId = `goal-resume-${randomUUID().slice(0, 8)}`;
    executeGsdAdapterAction(db, {
      adapterId: "cursor",
      actorAgentId: ACTOR,
      action: "create_task",
      payload: { title: "Resume path", goalId, lane: "code" },
      now: () => FIXED_NOW,
    });
    const resume = executeGsdAdapterAction(db, {
      adapterId: "telegram",
      actorAgentId: ACTOR,
      action: "resume",
      payload: { goalId, lane: "code" },
      now: () => FIXED_NOW,
    });
    expect(resume.ok).toBe(true);
    const standup = executeGsdAdapterAction(db, {
      adapterId: "discord",
      actorAgentId: ACTOR,
      action: "standup",
      payload: { goal_id: goalId, lane: "code" },
      now: () => FIXED_NOW,
    });
    expect(standup.ok).toBe(true);
    expect(standup.result).toMatchObject({ activeGoals: expect.any(Array) });
  });

  it("request_approval and discuss route bounded council with default payloads", async () => {
    const { getDb, executeGsdAdapterAction } = await loadModules();
    const db = getDb();
    const goalId = `goal-council-${randomUUID().slice(0, 8)}`;
    executeGsdAdapterAction(db, {
      adapterId: "claude_code",
      actorAgentId: ACTOR,
      action: "create_task",
      payload: { title: "Council path", goalId, lane: "research" },
      now: () => FIXED_NOW,
    });
    const approval = executeGsdAdapterAction(db, {
      adapterId: "codex",
      actorAgentId: ACTOR,
      action: "request_approval",
      payload: { goalId, topic: "ship batch26" },
      now: () => FIXED_NOW,
    });
    expect(approval.ok).toBe(false);
    expect(approval.result).toMatchObject({ blockedReasons: expect.any(Array) });
    const discussBlocked = executeGsdAdapterAction(db, {
      adapterId: "codex",
      actorAgentId: ACTOR,
      action: "discuss",
      payload: {
        goalId,
        topic: "Discuss batch26 blocked",
        lane: "research",
        roles: [{ role: "chair", agentId: ACTOR, mandate: "coordinate" }],
        taskBudget: { maxRounds: 2, maxAgents: 4 },
        verdict: {
          decision: "approve",
          summary: "missing validator branch",
          actionItems: [],
          risks: [],
          validatorPass: true,
        },
      },
      now: () => FIXED_NOW,
    });
    expect(discussBlocked.ok).toBe(false);

    const discussOk = executeGsdAdapterAction(db, {
      adapterId: "codex",
      actorAgentId: ACTOR,
      action: "discuss",
      payload: {
        goalId,
        topic: "Discuss batch26",
        lane: "research",
        roles: [
          { role: "chair", agentId: ACTOR, mandate: "coordinate" },
          { role: "validator", agentId: ACTOR, mandate: "validate" },
        ],
        taskBudget: { maxRounds: 2, maxAgents: 4 },
        verdict: {
          decision: "approve",
          summary: "Discuss batch26 verdict",
          actionItems: [],
          risks: [],
          validatorPass: true,
        },
      },
      now: () => FIXED_NOW,
    });
    expect(discussOk.ok).toBe(true);
  });

  it("model_route accepts snake_case task_id and sensitive flags", async () => {
    const { getDb, executeGsdAdapterAction } = await loadModules();
    const db = getDb();
    const route = executeGsdAdapterAction(db, {
      adapterId: "cursor",
      actorAgentId: ACTOR,
      action: "model_route",
      payload: {
        task_class: "classification",
        task_id: `task-${randomUUID().slice(0, 6)}`,
        sensitive: true,
        multimodal: false,
        highRisk: true,
      },
    });
    expect(route.ok).toBe(true);
    expect(route.result).toMatchObject({ taskClass: "classification" });
  });
});
