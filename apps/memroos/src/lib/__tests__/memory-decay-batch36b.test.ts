// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { _resetForTest, runDecay } from "@/lib/memory-decay";
import { createRetentionPolicy, registerRetentionRecord } from "@/lib/memory/retention-policy";
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
  testDb.exec("DELETE FROM messages");
  createRetentionPolicy(testDb, {
    id: `pol-decay-b36b-${randomUUID()}`,
    name: `decay b36b ${randomUUID().slice(0, 8)}`,
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

function seedSalience(tier: string, salience = 0.8) {
  const sessionId = `sess-b36b-${randomUUID()}`;
  testDb
    .prepare(
      `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, domain, policy)
       VALUES (?, 'alpha', 'agent', 'user', 'b36b', '2026-01-01T00:00:00Z', 'internal', 'eng', 'indexable')`,
    )
    .run(sessionId);
  const messageId = (testDb.prepare("SELECT id FROM messages WHERE session_id = ?").get(sessionId) as { id: number }).id;
  testDb
    .prepare(
      `INSERT INTO memory_salience(message_id, tier, salience_score, access_count, last_decay_at)
       VALUES (?, ?, ?, 1, '2026-01-01T00:00:00.000Z')`,
    )
    .run(messageId, tier, salience);
  return messageId;
}

describe("memory-decay batch36b", () => {
  it("returns lease_held when the same run_key already completed (197–202)", () => {
    const first = runDecay({ now: new Date("2026-11-02T00:00:00.000Z"), actorId: "operator-b36b" });
    expect(first.status).toBe("completed");
    const second = runDecay({ now: new Date("2026-11-02T00:00:00.000Z"), actorId: "operator-b36b" });
    expect(second.status).toBe("lease_held");
    expect(second.receipts).toEqual([]);
  });

  it("skips pinned tier rows with pinned receipt (251–255)", () => {
    const messageId = seedSalience("pinned");
    const summary = runDecay({ now: new Date("2026-11-02T00:00:00.000Z") });
    expect(summary.skippedPinned).toBe(1);
    const score = (testDb.prepare("SELECT salience_score FROM memory_salience WHERE message_id = ?").get(messageId) as {
      salience_score: number;
    }).salience_score;
    expect(score).toBe(0.8);
    expect(summary.receipts.some((r) => r.reason === "pinned")).toBe(true);
  });

  it("skips rows under an active legal hold (269–283)", () => {
    const messageId = seedSalience("low");
    const sessionId = `sess-hold-b36b-${randomUUID()}`;
    registerRetentionRecord(testDb, {
      recordType: "message",
      recordId: String(messageId),
      ontologyType: "memory.note",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", project: "alpha", agentId: "agent", sessionId },
      contentHash: randomUUID(),
      actorId: "operator-b36b",
      now: new Date("2026-03-01T00:00:00.000Z"),
    });
    createLegalHold(testDb, {
      scope: { tenantId: "default-tenant", recordId: String(messageId) },
      reasonCode: "hold-b36b",
      actorId: "operator-b36b",
      now: new Date("2026-03-01T12:00:00.000Z"),
    });
    const summary = runDecay({ now: new Date("2026-11-02T00:00:00.000Z") });
    expect(summary.skippedHeld).toBe(1);
    expect(summary.receipts.some((r) => r.reason === "active_legal_hold")).toBe(true);
  });
});
