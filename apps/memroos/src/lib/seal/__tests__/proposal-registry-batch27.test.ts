// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { PROPOSAL_TYPES } from "../proposal-registry";

let testDb: Database.Database;

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: vi.fn(),
}));

beforeEach(() => {
  testDb = new Database(":memory:");
  initSchema(testDb);
  testDb.prepare(
    "INSERT INTO registered_agents (id, name, role, platform, protocol, status, last_heartbeat_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run("agent-b27", "Agent B27", "ops", "codex", "local", "active", new Date().toISOString());
});

afterEach(() => {
  testDb.close();
});

describe("proposal-registry batch27 — resolveDb fallback and rollback guard", () => {
  it("skill_addition rollbackShadow deletes staged rows when insertedId is present", () => {
    const diff = {
      agentId: "agent-b27",
      skillId: "skill-b27",
      action: "add",
      metadata: { source: "batch27" },
    };
    const applied = PROPOSAL_TYPES.skill_addition.applyShadow(diff, testDb);
    expect(applied).toMatchObject({ applied: true, staged: true });

    PROPOSAL_TYPES.skill_addition.rollbackShadow?.(diff, applied, testDb);
    const remaining = testDb.prepare("SELECT COUNT(*) AS cnt FROM proposed_skills").get() as { cnt: number };
    expect(remaining.cnt).toBe(0);
  });

  it("skill_addition rollbackShadow no-ops when insertedId is missing", () => {
    testDb.prepare(
      "INSERT INTO proposed_skills (agent_id, skill_id, action, metadata, status) VALUES (?, ?, ?, ?, 'proposed')",
    ).run("agent-b27", "keep-skill-b27", "add", "{}");
    expect(() =>
      PROPOSAL_TYPES.skill_addition.rollbackShadow?.(
        { agentId: "agent-b27", skillId: "keep-skill-b27" },
        { applied: true },
      ),
    ).not.toThrow();
    const remaining = testDb.prepare("SELECT COUNT(*) AS cnt FROM proposed_skills").get() as { cnt: number };
    expect(remaining.cnt).toBe(1);
  });
});
