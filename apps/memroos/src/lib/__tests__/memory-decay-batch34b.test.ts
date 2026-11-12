// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { _resetForTest, runDecay } from "@/lib/memory-decay";
import { registerRetentionRecord, createRetentionPolicy } from "@/lib/memory/retention-policy";
import { createLegalHold } from "@/lib/memory/retention-expiry";

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
  testDb.exec("DELETE FROM memory_legal_holds");
  testDb.exec("DELETE FROM messages");
  createRetentionPolicy(testDb, {
    id: `pol-decay-b34b-${randomUUID()}`,
    name: `decay default ${randomUUID().slice(0, 8)}`,
    ontologyType: "memory.note",
    securityLabel: { visibility: "internal" },
    purpose: "recall",
    scope: { tenantId: "default-tenant" },
    durationDays: 30,
    actorId: "operator",
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  _resetForTest();
});

describe("memory-decay batch34b", () => {
  it("rejects invalid timestamps and applies access-resistance decay (65–71, 170–171)", () => {
    expect(() => runDecay({ now: "not-a-date" as never })).toThrow(/Invalid UTC timestamp/i);

    const sessionId = `sess-${randomUUID()}`;
    testDb
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, domain, policy)
         VALUES (?, 'alpha', 'agent', 'user', 'decay-low', '2026-01-01T00:00:00Z', 'internal', 'eng', 'indexable')`,
      )
      .run(sessionId);
    const messageId = (testDb.prepare("SELECT id FROM messages WHERE session_id = ?").get(sessionId) as { id: number }).id;
    testDb
      .prepare(
        `INSERT INTO memory_salience(message_id, tier, salience_score, access_count, last_decay_at)
         VALUES (?, 'low', 0.9, 9, '2026-01-01T00:00:00.000Z')`,
      )
      .run(messageId);

    runDecay({ now: new Date("2026-11-02T00:00:00.000Z") });
    const row = testDb
      .prepare("SELECT salience_score FROM memory_salience WHERE message_id = ?")
      .get(messageId) as { salience_score: number };
    expect(row.salience_score).toBeLessThan(0.9);
  });

  it("matches scope keys and skips rows on active legal hold (107–116, 200)", () => {
    const sessionId = `sess-${randomUUID()}`;
    testDb
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, domain, policy)
         VALUES (?, 'alpha', 'agent-a', 'user', 'held', '2026-01-01T00:00:00Z', 'internal', 'eng', 'indexable')`,
      )
      .run(sessionId);
    const messageId = (testDb.prepare("SELECT id FROM messages WHERE session_id = ?").get(sessionId) as { id: number }).id;
    testDb
      .prepare(
        `INSERT INTO memory_salience(message_id, tier, salience_score, access_count, last_decay_at)
         VALUES (?, 'high', 0.75, 0, '2026-01-01T00:00:00.000Z')`,
      )
      .run(messageId);

    registerRetentionRecord(testDb, {
      recordType: "message",
      recordId: String(messageId),
      ontologyType: "memory.note",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", project: "alpha", agentId: "agent-a", sessionId },
      contentHash: randomUUID(),
      actorId: "operator",
      now: new Date("2026-03-01T00:00:00.000Z"),
    });

    createLegalHold(testDb, {
      scope: { tenantId: "default-tenant", recordId: String(messageId) },
      reasonCode: "hold-b34b",
      actorId: "operator",
      now: new Date("2026-03-01T12:00:00.000Z"),
    });

    const summary = runDecay({
      now: new Date("2026-11-02T00:00:00.000Z"),
      scope: { tenantId: "default-tenant", project: "alpha", recordType: "message" },
    });
    expect(summary.skippedHeld).toBe(1);
    expect(summary.receipts.some((r) => r.reason === "active_legal_hold")).toBe(true);
  });

  it("replays completed run_key without re-decaying (200)", () => {
    const sessionId = `sess-${randomUUID()}`;
    testDb
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, domain, policy)
         VALUES (?, 'beta', 'agent-b', 'user', 'lease', '2026-01-01T00:00:00Z', 'internal', 'eng', 'indexable')`,
      )
      .run(sessionId);
    const messageId = (testDb.prepare("SELECT id FROM messages WHERE session_id = ?").get(sessionId) as { id: number }).id;
    testDb
      .prepare(
        `INSERT INTO memory_salience(message_id, tier, salience_score, access_count, last_decay_at)
         VALUES (?, 'high', 0.66, 0, '2026-01-01T00:00:00.000Z')`,
      )
      .run(messageId);

    const first = runDecay({ runKey: "decay-lease-b34b", now: new Date("2026-11-02T00:00:00.000Z") });
    const second = runDecay({ runKey: "decay-lease-b34b", now: new Date("2026-11-03T00:00:00.000Z") });
    expect(first.status).toBe("completed");
    expect(second.status).toBe("lease_held");
    expect(second.receipts).toEqual([]);
  });
});
