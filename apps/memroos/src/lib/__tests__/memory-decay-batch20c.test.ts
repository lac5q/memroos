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
  testDb.exec("DELETE FROM memory_decay_runs");
  testDb.exec("DELETE FROM memory_salience");
  testDb.exec("DELETE FROM messages");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("memory-decay batch20c", () => {
  it("returns lease_held when a completed run already exists for run_key", () => {
    const now = new Date("2026-08-01T12:00:00.000Z");
    const first = runDecay({ tenantId: "default-tenant", now });
    expect(first.status).toBe("completed");

    const second = runDecay({ tenantId: "default-tenant", now });
    expect(second.status).toBe("lease_held");
    expect(second.receipts).toEqual([]);
  });

  it("throws on invalid now timestamp", () => {
    expect(() => runDecay({ now: new Date("not-a-date") })).toThrow(/Invalid UTC timestamp/);
  });

  it("skips pinned tier rows without decaying salience", () => {
    const sessionId = `sess-${crypto.randomUUID()}`;
    testDb
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, domain, policy)
         VALUES (?, 'proj', 'agent', 'user', 'pinned', '2026-01-01T00:00:00Z', 'internal', 'eng', 'indexable')`,
      )
      .run(sessionId);
    const messageId = testDb.prepare("SELECT id FROM messages WHERE session_id = ?").get(sessionId) as {
      id: number;
    };
    testDb
      .prepare(
        `INSERT INTO memory_salience(message_id, tier, salience_score, access_count, last_decay_at)
         VALUES (?, 'pinned', 0.5, 0, '2026-01-01T00:00:00Z')`,
      )
      .run(messageId.id);

    const summary = runDecay({ tenantId: "default-tenant", now: new Date("2026-08-02T00:00:00Z") });
    expect(summary.skippedPinned).toBe(1);
    expect(summary.decayed).toBe(0);
  });
});
