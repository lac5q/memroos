// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildGsdResume,
  buildGsdStandup,
  createOrResumeGsdGoal,
  gsdInputFromJson,
  gsdStringArray,
  runGsdShipcheck,
} from "@/lib/agent-gsd-control";
import { initSchema } from "@/lib/db-schema";

const db = new Database(":memory:");
initSchema(db);

afterEach(() => {
  db.prepare("DELETE FROM hive_actions").run();
  db.prepare("DELETE FROM hive_delegations").run();
  db.prepare("DELETE FROM agent_checkpoints").run();
});

describe("agent-gsd-control batch20b", () => {
  it("createOrResumeGsdGoal upserts the same goalId on resume", () => {
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    createOrResumeGsdGoal(db, {
      goalId,
      title: "First title",
      actorAgentId: "codex-cli-agent",
      lane: "research",
    });
    const resumed = createOrResumeGsdGoal(db, {
      goalId,
      title: "Updated title",
      actorAgentId: "codex-cli-agent",
      lane: "research",
    });
    expect(resumed.goalId).toBe(goalId);
    expect(resumed.packet.goal.title).toBe("Updated title");
  });

  it("runGsdShipcheck rejects bypass reasons shorter than 8 characters", () => {
    const goal = createOrResumeGsdGoal(db, {
      title: "Bypass short",
      actorAgentId: "codex-cli-agent",
      lane: "code",
    });
    const blocked = runGsdShipcheck(db, {
      goalId: goal.goalId,
      actorAgentId: "codex-cli-agent",
      lane: "code",
      proof: {},
      bypassReason: "tiny",
    });
    expect(blocked.status).toBe("blocked");
    expect(blocked.message).toMatch(/8 characters/);
  });

  it("runGsdShipcheck verifies when required proof is supplied", () => {
    const goal = createOrResumeGsdGoal(db, {
      title: "Verified shipcheck",
      actorAgentId: "codex-cli-agent",
      lane: "code",
    });
    const verified = runGsdShipcheck(db, {
      goalId: goal.goalId,
      actorAgentId: "codex-cli-agent",
      lane: "code",
      proof: { focused_tests: "vitest green" },
    });
    expect(verified.status).toBe("verified");
    expect(verified.missingProof).toEqual([]);
  });

  it("buildGsdResume surfaces checkpoint next actions", () => {
    const goal = createOrResumeGsdGoal(db, {
      title: "Resume path",
      actorAgentId: "codex-cli-agent",
      lane: "ops",
    });
    const resume = buildGsdResume(db, {
      goalId: goal.goalId,
      actorAgentId: "codex-cli-agent",
      lane: "ops",
    });
    expect(resume.resume.status).toMatch(/active|planned/);
    expect(resume.packet.goal.id).toBe(goal.goalId);
  });

  it("buildGsdStandup lists active goals and recent shipcheck proof", () => {
    const goal = createOrResumeGsdGoal(db, {
      title: "Standup goal",
      actorAgentId: "codex-cli-agent",
      lane: "memory",
    });
    runGsdShipcheck(db, {
      goalId: goal.goalId,
      actorAgentId: "codex-cli-agent",
      lane: "memory",
      proof: { memory_write_receipt: "written" },
    });
    const standup = buildGsdStandup(db, {
      actorAgentId: "codex-cli-agent",
      goalId: goal.goalId,
      limit: 5,
    });
    expect(standup.activeGoals.some((g) => g.goalId === goal.goalId)).toBe(true);
    expect(standup.recentProof.length).toBeGreaterThan(0);
  });

  it("gsdInputFromJson and gsdStringArray ignore non-object and non-string entries", () => {
    expect(gsdInputFromJson(null)).toEqual({});
    expect(gsdInputFromJson(["array"])).toEqual({});
    expect(gsdStringArray(["ok", "", 3, "  trimmed  "])).toEqual(["ok", "  trimmed  "]);
  });
});
