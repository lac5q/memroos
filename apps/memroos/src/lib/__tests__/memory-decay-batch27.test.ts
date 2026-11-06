// @vitest-environment node
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { _resetForTest, runDecay } from "@/lib/memory-decay";

const testDb = new Database(":memory:");
initSchema(testDb);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

beforeEach(() => {
  _resetForTest();
  initSchema(testDb);
  testDb.exec("DELETE FROM memory_decay_runs");
  testDb.exec("DELETE FROM memory_decay_receipts");
  testDb.exec("DELETE FROM memory_salience");
  testDb.exec("DELETE FROM memory_retention_records");
  testDb.exec("DELETE FROM messages");
});

afterEach(() => {
  vi.restoreAllMocks();
  _resetForTest();
});

describe("memory-decay batch27 — missing retention table", () => {
  it("runDecay proceeds when memory_retention_records table is absent", () => {
    testDb.exec("DROP TABLE memory_retention_records");
    const sessionId = `sess-${crypto.randomUUID()}`;
    testDb
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, domain, policy)
         VALUES (?, 'proj', 'agent', 'user', 'no-retention-table', '2026-01-01T00:00:00Z', 'internal', 'eng', 'indexable')`,
      )
      .run(sessionId);
    const messageId = (
      testDb.prepare("SELECT id FROM messages WHERE session_id = ?").get(sessionId) as { id: number }
    ).id;
    testDb
      .prepare(
        `INSERT INTO memory_salience(message_id, tier, salience_score, access_count, last_decay_at)
         VALUES (?, 'high', 0.6, 0, '2026-01-01T00:00:00Z')`,
      )
      .run(messageId);

    const summary = runDecay({
      tenantId: "default-tenant",
      now: new Date("2026-11-03T00:00:00Z"),
    });
    expect(summary.considered).toBe(1);
    expect(summary.decayed).toBe(1);
  });
});
