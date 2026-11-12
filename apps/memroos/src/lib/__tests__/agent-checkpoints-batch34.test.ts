// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { createAgentCheckpoint, verifyCheckpointAuditChain } from "@/lib/agent-checkpoints";
import { initSchema } from "@/lib/db-schema";

describe("agent-checkpoints batch34", () => {
  it("buildReceipt returns null for unsupported efficiency event types (223)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const runId = `run-b34-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, event_type, task_id, agent_id, payload, created_at)
       VALUES ('default-tenant', 'operator_question', ?, 'agent-b34', ?, '2026-11-11T00:00:00.000Z')`,
    ).run(runId, JSON.stringify({ question: "unsupported b34" }));

    const checkpoint = createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "agent-b34",
      objective: "Filter unsupported receipts",
      nextSafeAction: "continue",
    });
    expect(checkpoint.provenanceAudit?.provenanceReceiptCount).toBe(0);
    db.close();
  });

  it("verifyCheckpointAuditChain skips audit rows missing checkpointHash (316)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const runId = `run-audit-b34-${randomUUID().slice(0, 8)}`;
    const checkpoint = createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "agent-b34",
      objective: "Malformed audit metadata b34",
      nextSafeAction: "continue",
    });

    db.prepare(
      `INSERT INTO audit_entries
        (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
       VALUES
        ('default-tenant', 'agent-b34', 'agent', 'agent.checkpoint.created', 'agent_checkpoint', ?, 'missing hash b34', ?, '2026-11-11T00:00:02.000Z')`,
    ).run(`agent_checkpoint:${checkpoint.id}`, JSON.stringify({ entryHash: checkpoint.provenanceAudit?.entryHash }));

    const chain = verifyCheckpointAuditChain(db, "default-tenant");
    expect(chain.valid).toBe(true);
    expect(chain.checked).toBeGreaterThanOrEqual(1);
    db.close();
  });
});
