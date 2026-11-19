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
  testDb.exec("DELETE FROM memory_decay_receipts");
  testDb.exec("DELETE FROM memory_salience");
  testDb.exec("DELETE FROM memory_retention_records");
  testDb.exec("DELETE FROM messages");
});

afterEach(() => {
  vi.restoreAllMocks();
  _resetForTest();
});

describe("memory-decay batch26 — unknown tier, empty scope arrays, wildcard scope keys", () => {
  it("runDecay skips pinned-tier rows without changing salience", () => {
    const sessionId = `sess-${crypto.randomUUID()}`;
    testDb
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, domain, policy)
         VALUES (?, 'proj', 'agent', 'user', 'pinned-tier', '2026-01-01T00:00:00Z', 'internal', 'eng', 'indexable')`,
      )
      .run(sessionId);
    const messageId = (
      testDb.prepare("SELECT id FROM messages WHERE session_id = ?").get(sessionId) as { id: number }
    ).id;
    testDb
      .prepare(
        `INSERT INTO memory_salience(message_id, tier, salience_score, access_count, last_decay_at)
         VALUES (?, 'pinned', 0.77, 0, '2026-01-01T00:00:00Z')`,
      )
      .run(messageId);

    const summary = runDecay({
      tenantId: "default-tenant",
      now: new Date("2026-11-02T00:00:00Z"),
    });
    const row = testDb
      .prepare("SELECT salience_score FROM memory_salience WHERE message_id = ?")
      .get(messageId) as { salience_score: number };
    expect(row.salience_score).toBeCloseTo(0.77);
    expect(summary.receipts.some((r) => r.recordId === String(messageId) && r.decision === "skipped")).toBe(
      true,
    );
  });

  it("runDecay rejects empty array scope filters", () => {
    const sessionId = `sess-${crypto.randomUUID()}`;
    testDb
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, domain, policy)
         VALUES (?, 'alpha', 'agent-a', 'user', 'scoped', '2026-01-01T00:00:00Z', 'internal', 'eng', 'indexable')`,
      )
      .run(sessionId);
    const messageId = (
      testDb.prepare("SELECT id FROM messages WHERE session_id = ?").get(sessionId) as { id: number }
    ).id;
    testDb
      .prepare(
        `INSERT INTO memory_salience(message_id, tier, salience_score, access_count, last_decay_at)
         VALUES (?, 'high', 0.8, 0, '2026-01-01T00:00:00Z')`,
      )
      .run(messageId);

    const summary = runDecay({
      tenantId: "default-tenant",
      now: new Date("2026-11-02T00:00:00Z"),
      scope: { project: [] } as never,
    });
    expect(summary.considered).toBe(0);
  });

  it("runDecay treats '*' scope values as wildcards", () => {
    const sessionId = `sess-${crypto.randomUUID()}`;
    testDb
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, domain, policy)
         VALUES (?, 'alpha', 'agent-a', 'user', 'wild', '2026-01-01T00:00:00Z', 'internal', 'eng', 'indexable')`,
      )
      .run(sessionId);
    const messageId = (
      testDb.prepare("SELECT id FROM messages WHERE session_id = ?").get(sessionId) as { id: number }
    ).id;
    testDb
      .prepare(
        `INSERT INTO memory_salience(message_id, tier, salience_score, access_count, last_decay_at)
         VALUES (?, 'high', 0.8, 0, '2026-01-01T00:00:00Z')`,
      )
      .run(messageId);

    const summary = runDecay({
      tenantId: "default-tenant",
      now: new Date("2026-11-02T00:00:00Z"),
      scope: { project: "*" } as never,
    });
    expect(summary.considered).toBe(1);
  });
});
