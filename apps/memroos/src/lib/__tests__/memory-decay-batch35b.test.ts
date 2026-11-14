// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { _resetForTest, runDecay } from "@/lib/memory-decay";
import { createRetentionPolicy } from "@/lib/memory/retention-policy";

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
  createRetentionPolicy(testDb, {
    id: `pol-decay-b35b-${randomUUID()}`,
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

describe("memory-decay batch35b", () => {
  it("preserves salience when tier has no decay rate (170)", () => {
    const sessionId = `sess-b35b-${randomUUID()}`;
    testDb
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, domain, policy)
         VALUES (?, 'alpha', 'agent', 'user', 'unknown-tier', '2026-01-01T00:00:00Z', 'internal', 'eng', 'indexable')`,
      )
      .run(sessionId);
    const messageId = (testDb.prepare("SELECT id FROM messages WHERE session_id = ?").get(sessionId) as { id: number }).id;
    testDb.pragma("ignore_check_constraints = ON");
    testDb
      .prepare(
        `INSERT INTO memory_salience(message_id, tier, salience_score, access_count, last_decay_at)
         VALUES (?, 'unknown_tier_b35b', 0.75, 2, '2026-01-01T00:00:00.000Z')`,
      )
      .run(messageId);
    testDb.pragma("ignore_check_constraints = OFF");

    runDecay({ now: new Date("2026-11-02T00:00:00.000Z") });
    const row = testDb
      .prepare("SELECT salience_score FROM memory_salience WHERE message_id = ?")
      .get(messageId) as { salience_score: number };
    expect(row.salience_score).toBe(0.75);
  });

  it("still decays known low tier rows in the same cycle", () => {
    const sessionId = `sess-b35b-${randomUUID()}`;
    testDb
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, domain, policy)
         VALUES (?, 'alpha', 'agent', 'user', 'low-tier', '2026-01-01T00:00:00Z', 'internal', 'eng', 'indexable')`,
      )
      .run(sessionId);
    const messageId = (testDb.prepare("SELECT id FROM messages WHERE session_id = ?").get(sessionId) as { id: number }).id;
    testDb
      .prepare(
        `INSERT INTO memory_salience(message_id, tier, salience_score, access_count, last_decay_at)
         VALUES (?, 'low', 0.75, 2, '2026-01-01T00:00:00.000Z')`,
      )
      .run(messageId);

    runDecay({ now: new Date("2026-11-02T00:00:00.000Z") });
    const row = testDb
      .prepare("SELECT salience_score FROM memory_salience WHERE message_id = ?")
      .get(messageId) as { salience_score: number };
    expect(row.salience_score).toBeLessThan(0.75);
  });
});
