// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB_DIR = path.join(os.tmpdir(), `gsd-adapters-b25-${randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "adapters.db");

async function loadModules() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  vi.resetModules();
  const dbModule = await import("@/lib/db");
  const adapters = await import("@/lib/gsd/adapters");
  return { getDb: dbModule.getDb, closeDb: dbModule.closeDb, ...adapters };
}

const ACTOR = "adapter-b25-agent";
const FIXED_NOW = new Date("2026-11-01T09:00:00.000Z");

describe("GSD adapters batch25 — payload aliases and blocked proof", () => {
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

  it("create_task accepts goal alias fields and undefined payload defaults", async () => {
    const { getDb, executeGsdAdapterAction } = await loadModules();
    const db = getDb();
    const goalId = `goal-b25-${randomUUID().slice(0, 8)}`;
    expect(() =>
      executeGsdAdapterAction(db, {
        adapterId: "codex",
        actorAgentId: ACTOR,
        action: "create_task",
        payload: undefined as unknown as Record<string, unknown>,
      }),
    ).toThrow(/goal title is required/);

    const withGoal = executeGsdAdapterAction(db, {
      adapterId: "hermes",
      actorAgentId: ACTOR,
      action: "create_task",
      payload: {
        goal: "Adapter goal alias title",
        goal_id: goalId,
        owner: ACTOR,
        lane: "research",
        acceptanceCriteria: ["source_receipts"],
      },
      now: () => FIXED_NOW,
    });
    expect(withGoal.ok).toBe(true);
    expect(withGoal.result).toMatchObject({ goalId });
  });

  it("post_proof returns ok=false when shipcheck is blocked", async () => {
    const { getDb, executeGsdAdapterAction } = await loadModules();
    const db = getDb();
    const goalId = `goal-block-${randomUUID().slice(0, 8)}`;
    executeGsdAdapterAction(db, {
      adapterId: "codex",
      actorAgentId: ACTOR,
      action: "create_task",
      payload: { title: "Blocked proof path", goalId, lane: "code" },
      now: () => FIXED_NOW,
    });
    const proof = executeGsdAdapterAction(db, {
      adapterId: "telegram",
      actorAgentId: ACTOR,
      action: "post_proof",
      payload: { goal_id: goalId, lane: "code", proof: {} },
      now: () => FIXED_NOW,
    });
    expect(proof.ok).toBe(false);
    expect(proof.result).toMatchObject({ status: "blocked" });
  });

  it("model_route and lane_eval honor snake_case and default persistence flags", async () => {
    const { getDb, executeGsdAdapterAction } = await loadModules();
    const db = getDb();
    const route = executeGsdAdapterAction(db, {
      adapterId: "cursor",
      actorAgentId: ACTOR,
      action: "model_route",
      payload: { task_class: "classification", highRisk: true, sensitive: true },
    });
    expect(route.ok).toBe(true);
    expect(route.result).toMatchObject({ taskClass: "classification" });

    const laneEval = executeGsdAdapterAction(db, {
      adapterId: "claude_code",
      actorAgentId: ACTOR,
      action: "lane_eval",
      payload: { persistReceipts: true },
      now: () => FIXED_NOW,
    });
    expect(laneEval.ok).toBe(true);
    expect(laneEval.result).toMatchObject({ totalCases: expect.any(Number) });

    const audit = executeGsdAdapterAction(db, {
      adapterId: "discord",
      actorAgentId: ACTOR,
      action: "skill_audit",
      payload: { persistProposals: true },
      now: () => FIXED_NOW,
    });
    expect(audit.ok).toBe(true);
  });
});
