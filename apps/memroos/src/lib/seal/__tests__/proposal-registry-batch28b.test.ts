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
  ).run("agent-b28b", "Agent B28B", "ops", "codex", "local", "active", new Date().toISOString());
});

afterEach(() => {
  testDb.close();
});

describe("proposal-registry batch28b — noop and memory_rewrite shadows", () => {
  it("noop_test applyShadow echoes applied without DB writes", () => {
    const applied = PROPOSAL_TYPES.noop_test.applyShadow({ kind: "noop", note: "batch28b" });
    expect(applied).toMatchObject({ applied: true, diff: { kind: "noop" } });
    const proposals = testDb.prepare("SELECT COUNT(*) AS cnt FROM proposed_skills").get() as { cnt: number };
    expect(proposals.cnt).toBe(0);
  });

  it("memory_rewrite applyShadow marks pendingWrite while recording diff", () => {
    const diff = {
      kind: "memory_rewrite",
      memoryId: "mem-b28b",
      before: "old",
      after: "new",
      tier: "vector",
    };
    const applied = PROPOSAL_TYPES.memory_rewrite.applyShadow(diff);
    expect(applied).toMatchObject({ applied: true, pendingWrite: true, diff });
  });
});
