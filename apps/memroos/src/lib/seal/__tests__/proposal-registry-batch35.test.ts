// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { PROPOSAL_TYPES } from "../proposal-registry";

let testDb: Database.Database;
const agentId = `agent-b35-${randomUUID().slice(0, 8)}`;

beforeEach(() => {
  testDb = new Database(":memory:");
  initSchema(testDb);
  testDb
    .prepare(
      `INSERT INTO registered_agents (id, name, role, platform, protocol)
       VALUES (?, 'Batch35 Agent', 'Worker', 'codex', 'rest')`,
    )
    .run(agentId);
});

afterEach(() => {
  testDb.close();
});

describe("proposal-registry batch35", () => {
  it.skip("resolveDb default require('@/lib/db') (24-25) — Vitest alias prevents CJS fallback", () => {});

  it("agent_instruction_patch applyShadow refuses when agentId missing (271)", () => {
    const apply = PROPOSAL_TYPES.agent_instruction_patch.applyShadow(
      { after: "text" },
      testDb,
    ) as { applied: boolean; reason?: string };
    expect(apply.applied).toBe(false);
    expect(apply.reason).toMatch(/Missing agentId/);
  });

  it("tool_routing_update applyShadow inserts a replacement policy row", () => {
    const apply = PROPOSAL_TYPES.tool_routing_update.applyShadow(
      { agentId, toolName: "read", newWeight: 0.75 },
      testDb,
    ) as { applied: boolean; insertedId?: number };
    expect(apply.applied).toBe(true);
    expect(apply.insertedId).toBeGreaterThan(0);
  });

  it("instruction_update rollbackShadow is no-op when apply did not insert", () => {
    const noopApply = { applied: false as const };
    expect(() =>
      PROPOSAL_TYPES.agent_instruction_patch.rollbackShadow({}, noopApply, testDb),
    ).not.toThrow();
  });
});
