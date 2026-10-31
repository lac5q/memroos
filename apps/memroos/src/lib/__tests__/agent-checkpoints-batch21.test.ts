// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { createAgentCheckpoint } from "@/lib/agent-checkpoints";
import { initSchema } from "@/lib/db-schema";

describe("agent-checkpoints batch21 — provenance edge paths", () => {
  it("ignores unknown efficiency event types and array-shaped payloads that normalize empty", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const runId = `run-${randomUUID().slice(0, 8)}`;
    // Array payload → parseJsonRecord returns {} but memory_write still emits a receipt.
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, event_type, task_id, agent_id, payload, created_at)
       VALUES ('default-tenant', 'memory_write', ?, 'agent-b21', ?, '2026-07-10T00:00:00.000Z')`,
    ).run(runId, JSON.stringify(["not", "an", "object"]));
    // Unknown type is filtered by the SQL event_type IN (...) clause.
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, event_type, task_id, agent_id, payload, created_at)
       VALUES ('default-tenant', 'token_ledger', ?, 'agent-b21', '{}', '2026-07-10T00:00:01.000Z')`,
    ).run(runId);
    const checkpoint = createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "agent-b21",
      objective: "Provenance edge cases",
      nextSafeAction: "continue",
    });
    expect(checkpoint.provenanceAudit?.provenanceReceiptCount).toBe(1);
    db.close();
  });

  it("returns empty provenance when efficiency_events table is unavailable", () => {
    const db = new Database(":memory:");
    initSchema(db);
    db.exec("DROP TABLE efficiency_events");
    const runId = `run-${randomUUID().slice(0, 8)}`;
    const checkpoint = createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "agent-b21",
      objective: "No events table",
      nextSafeAction: "continue",
    });
    expect(checkpoint.provenanceAudit?.provenanceReceiptCount).toBe(0);
    db.close();
  });
});
