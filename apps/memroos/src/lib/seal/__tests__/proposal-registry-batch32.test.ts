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
  testDb
    .prepare(
      "INSERT INTO registered_agents (id, name, role, platform, protocol, status, last_heartbeat_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      `agent-b32-${Date.now()}`,
      "Agent B32",
      "ops",
      "codex",
      "local",
      "active",
      new Date().toISOString(),
    );
});

afterEach(() => {
  testDb.close();
});

describe("proposal-registry batch32 — applyShadow with explicit db", () => {
  // sticky: resolveDb require("@/lib/db") (24-25) — CJS require does not honor Vitest @ alias.
  it.skip("resolveDb default require path is unreachable under vitest alias resolution", () => {});

  it("skill_addition applyShadow stages a proposed skill when db is provided", () => {
    const agentId = testDb.prepare("SELECT id FROM registered_agents LIMIT 1").pluck().get() as string;
    const applied = PROPOSAL_TYPES.skill_addition.applyShadow(
      {
        agentId,
        skillId: "skill-b32",
        action: "add",
        metadata: { source: "batch32" },
      },
      testDb,
    );
    expect(applied).toMatchObject({ applied: true, staged: true });
    const count = testDb.prepare("SELECT COUNT(*) AS cnt FROM proposed_skills").get() as { cnt: number };
    expect(count.cnt).toBeGreaterThan(0);
  });
});
