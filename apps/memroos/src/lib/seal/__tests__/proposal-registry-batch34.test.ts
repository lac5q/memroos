// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { PROPOSAL_TYPES } from "../proposal-registry";

let testDb: Database.Database;

const agentId = `agent-b34-${randomUUID().slice(0, 8)}`;

beforeEach(() => {
  testDb = new Database(":memory:");
  initSchema(testDb);
  testDb
    .prepare(
      `INSERT INTO registered_agents (id, name, role, platform, protocol)
       VALUES (?, 'Batch34 Agent', 'Worker', 'codex', 'rest')`,
    )
    .run(agentId);
});

afterEach(() => {
  testDb.close();
});

describe("proposal-registry batch34", () => {
  it.skip("resolveDb default require('@/lib/db') (24-25) — Vitest alias prevents CJS fallback", () => {});

  it("instruction_update rollbackShadow restores prior active rows (304)", () => {
    testDb.prepare(
      "INSERT INTO agent_instructions (agent_id, instructions_text, version, is_active) VALUES (?, ?, 1, 1)",
    ).run(agentId, "before b34");
    const priorId = Number(
      testDb.prepare("SELECT id FROM agent_instructions WHERE agent_id = ? AND is_active = 1").pluck().get(agentId),
    );
    const apply = PROPOSAL_TYPES.agent_instruction_patch.applyShadow(
      { agentId, after: "after b34" },
      testDb,
    ) as { applied: boolean; insertedId?: number };
    expect(apply.applied).toBe(true);
    PROPOSAL_TYPES.agent_instruction_patch.rollbackShadow({}, apply, testDb);
    const active = testDb
      .prepare("SELECT id, instructions_text FROM agent_instructions WHERE agent_id = ? AND is_active = 1")
      .all(agentId) as Array<{ id: number; instructions_text: string }>;
    expect(active.some((row) => row.id === priorId)).toBe(true);
  });

  it("tool_routing_update rollbackShadow restores deactivated policy rows (435)", () => {
    testDb.prepare(
      `INSERT INTO agent_tool_routing_policies (agent_id, tool_name, context_pattern, preference_weight, is_active)
       VALUES (?, 'grep', '*', 0.5, 1)`,
    ).run(agentId);
    const priorId = Number(
      testDb
        .prepare("SELECT id FROM agent_tool_routing_policies WHERE agent_id = ? AND tool_name = 'grep' AND is_active = 1")
        .pluck()
        .get(agentId),
    );
    const apply = PROPOSAL_TYPES.tool_routing_update.applyShadow(
      { agentId, toolName: "grep", newWeight: 0.9 },
      testDb,
    ) as { applied: boolean; insertedId?: number; previousActiveIds?: number[] };
    expect(apply.applied).toBe(true);
    PROPOSAL_TYPES.tool_routing_update.rollbackShadow({}, apply, testDb);
    const restored = testDb
      .prepare("SELECT id, is_active FROM agent_tool_routing_policies WHERE id = ?")
      .get(priorId) as { id: number; is_active: number };
    expect(restored.is_active).toBe(1);
  });
});
