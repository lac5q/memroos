// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createAgentCheckpoint } from "@/lib/agent-checkpoints";
import { initSchema } from "@/lib/db-schema";

afterEach(() => {
  // per-test db.close()
});

describe("agent-checkpoints batch32 — unsupported efficiency events", () => {
  it("buildReceipt ignores operator_question efficiency events (line 223)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const runId = `run-b32-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, event_type, task_id, agent_id, payload, created_at)
       VALUES ('default-tenant', 'operator_question', ?, 'agent-b32', ?, '2026-11-09T00:00:00.000Z')`,
    ).run(runId, JSON.stringify({ question: "batch32 unsupported" }));

    const checkpoint = createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "agent-b32",
      objective: "Unsupported operator event",
      nextSafeAction: "continue",
    });
    expect(checkpoint.provenanceAudit?.provenanceReceiptCount ?? 0).toBe(0);
    db.close();
  });

  it("buildReceipt maps memory_write events into provenance receipts", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const runId = `run-b32-write-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, event_type, task_id, agent_id, payload, created_at)
       VALUES ('default-tenant', 'memory_write', ?, 'agent-b32', ?, '2026-11-09T00:00:00.000Z')`,
    ).run(runId, JSON.stringify({ canonicalId: `canon-b32-${randomUUID().slice(0, 6)}`, storeId: "vault" }));

    const checkpoint = createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "agent-b32",
      objective: "Memory write receipt",
      nextSafeAction: "continue",
    });
    expect(checkpoint.provenanceAudit?.provenanceReceiptCount).toBeGreaterThanOrEqual(1);
    db.close();
  });
});
