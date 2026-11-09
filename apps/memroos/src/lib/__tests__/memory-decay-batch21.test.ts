// @vitest-environment node
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { _resetForTest, hasLogFunction, runDecay } from "@/lib/memory-decay";

const testDb = new Database(":memory:");
initSchema(testDb);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

beforeEach(() => {
  _resetForTest();
  testDb.exec("DELETE FROM memory_decay_runs");
  testDb.exec("DELETE FROM memory_salience");
  testDb.exec("DELETE FROM messages");
});

afterEach(() => {
  vi.restoreAllMocks();
  _resetForTest();
});

describe("memory-decay batch21 — LOG probe and scope arrays", () => {
  it("hasLogFunction returns false when SQLite lacks LOG()", () => {
    const originalPrepare = testDb.prepare.bind(testDb);
    vi.spyOn(testDb, "prepare").mockImplementation((sql: string) => {
      if (sql.includes("LOG(")) {
        throw new Error("no such function: LOG");
      }
      return originalPrepare(sql);
    });
    _resetForTest();
    expect(hasLogFunction()).toBe(false);
  });

  it("runDecay skips rows outside array-valued scope filters", () => {
    const sessionId = `sess-${crypto.randomUUID()}`;
    testDb
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, domain, policy)
         VALUES (?, 'alpha', 'agent-a', 'user', 'scoped', '2026-01-01T00:00:00Z', 'internal', 'eng', 'indexable')`,
      )
      .run(sessionId);
    const sessionOther = `sess-${crypto.randomUUID()}`;
    testDb
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, domain, policy)
         VALUES (?, 'beta', 'agent-b', 'user', 'other', '2026-01-01T00:00:00Z', 'internal', 'eng', 'indexable')`,
      )
      .run(sessionOther);
    const alphaId = (testDb.prepare("SELECT id FROM messages WHERE session_id = ?").get(sessionId) as { id: number }).id;
    const betaId = (testDb.prepare("SELECT id FROM messages WHERE session_id = ?").get(sessionOther) as { id: number }).id;
    testDb
      .prepare(
        `INSERT INTO memory_salience(message_id, tier, salience_score, access_count, last_decay_at)
         VALUES (?, 'high', 0.8, 0, '2026-01-01T00:00:00Z')`,
      )
      .run(alphaId);
    testDb
      .prepare(
        `INSERT INTO memory_salience(message_id, tier, salience_score, access_count, last_decay_at)
         VALUES (?, 'high', 0.8, 0, '2026-01-01T00:00:00Z')`,
      )
      .run(betaId);

    const summary = runDecay({
      tenantId: "default-tenant",
      now: new Date("2026-08-02T00:00:00Z"),
      scope: { project: ["alpha"] } as never,
    });
    expect(summary.considered).toBe(1);
  });
});
