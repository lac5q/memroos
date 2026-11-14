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

describe("memory-decay batch28 — pinned skip and lease replay", () => {
  it("runDecay skips pinned tier rows with skipped receipt reason", () => {
    const sessionId = `sess-${crypto.randomUUID()}`;
    testDb
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, domain, policy)
         VALUES (?, 'proj', 'agent', 'user', 'pinned batch28', '2020-01-01T00:00:00Z', 'internal', 'eng', 'indexable')`,
      )
      .run(sessionId);
    const messageId = (
      testDb.prepare("SELECT id FROM messages WHERE session_id = ?").get(sessionId) as { id: number }
    ).id;
    testDb
      .prepare(
        `INSERT INTO memory_salience(message_id, tier, salience_score, access_count, last_decay_at)
         VALUES (?, 'pinned', 0.9, 0, '2020-01-01T00:00:00Z')`,
      )
      .run(messageId);

    const summary = runDecay({
      tenantId: "default-tenant",
      now: new Date("2026-11-03T00:00:00Z"),
    });
    expect(summary.skippedPinned).toBe(1);
    expect(summary.decayed).toBe(0);
    expect(summary.receipts.some((r) => r.reason === "pinned")).toBe(true);
  });

  it("runDecay returns lease_held when an identical run_key already completed", () => {
    const runKey = "decay:default-tenant:2026-11-03:batch28lease";
    testDb.prepare(
      `INSERT INTO memory_decay_runs
         (run_key, tenant_id, cycle_id, status, scope_json, scope_hash, actor_id, scheduled_for, started_at, completed_at, summary_json)
       VALUES (?, 'default-tenant', '2026-11-03', 'completed', '{}', 'batch28', 'system', datetime('now'), datetime('now'), datetime('now'), ?)`,
    ).run(
      runKey,
      JSON.stringify({
        runKey,
        cycleId: "2026-11-03",
        tenantId: "default-tenant",
        status: "completed",
        considered: 2,
        decayed: 1,
        skippedPinned: 0,
        skippedHeld: 0,
        skippedProtected: 0,
        skippedExempt: 0,
        skippedNotDue: 0,
        receipts: [],
      }),
    );

    const summary = runDecay({
      tenantId: "default-tenant",
      runKey,
      now: new Date("2026-11-03T12:00:00Z"),
    });
    expect(summary.status).toBe("lease_held");
    expect(summary.considered).toBe(2);
    expect(summary.receipts).toEqual([]);
  });
});
