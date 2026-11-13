// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createAgentCheckpoint, verifyCheckpointAuditChain } from "@/lib/agent-checkpoints";
import { initSchema } from "@/lib/db-schema";

afterEach(() => {
  // per-test db.close()
});

describe("agent-checkpoints batch33 — boundary receipts and malformed audit rows", () => {
  it("buildReceipt maps source_read and retrieval_trace events (168, 209)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const runId = `run-b33-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, event_type, task_id, agent_id, payload, created_at)
       VALUES
        ('default-tenant', 'source_read', ?, 'agent-b33', ?, '2026-11-10T00:00:00.000Z'),
        ('default-tenant', 'retrieval_trace', ?, 'agent-b33', ?, '2026-11-10T00:00:01.000Z'),
        ('default-tenant', 'operator_question', ?, 'agent-b33', ?, '2026-11-10T00:00:02.000Z')`,
    ).run(
      runId,
      JSON.stringify({ sourceId: "kb://note-b33", toolId: "read_file" }),
      runId,
      JSON.stringify({ sources: ["vector", "lexical"], query: "batch33 query" }),
      runId,
      JSON.stringify({ question: "unsupported b33" }),
    );

    const checkpoint = createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "agent-b33",
      objective: "Boundary provenance",
      nextSafeAction: "continue",
    });
    expect(checkpoint.provenanceAudit?.provenanceReceiptCount).toBe(2);
    db.close();
  });

  it("auditReceiptFromRow returns null when checkpointHash missing (316)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const runId = `run-audit-b33-${randomUUID().slice(0, 8)}`;
    const checkpoint = createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "agent-b33",
      objective: "Malformed audit metadata",
      nextSafeAction: "continue",
    });

    db.prepare(
      `INSERT INTO audit_entries
        (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
       VALUES
        ('default-tenant', 'agent-b33', 'agent', 'agent.checkpoint.created', 'agent_checkpoint', ?, 'missing checkpoint hash', ?, '2026-11-10T00:00:02.000Z')`,
    ).run(`agent_checkpoint:${checkpoint.id}`, JSON.stringify({ entryHash: checkpoint.provenanceAudit?.entryHash }));

    const chain = verifyCheckpointAuditChain(db, "default-tenant");
    expect(chain.valid).toBe(true);
    db.close();
  });
});
