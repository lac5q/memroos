// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAgentCheckpoint, verifyCheckpointAuditChain } from "@/lib/agent-checkpoints";
import { initSchema } from "@/lib/db-schema";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("agent-checkpoints batch30b — parseJson guards and receipt filtering", () => {
  it("parseJsonRecord treats empty payload as {} (line 130)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const runId = `run-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, event_type, task_id, agent_id, payload, created_at)
       VALUES ('default-tenant', 'memory_write', ?, 'agent-b30b', '', '2026-11-07T00:00:00.000Z')`,
    ).run(runId);

    const checkpoint = createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "agent-b30b",
      objective: "Empty payload",
      nextSafeAction: "continue",
    });
    expect(checkpoint.provenanceAudit?.provenanceReceiptCount).toBe(1);
    db.close();
  });

  it("buildReceipt returns null for unsupported efficiency events (line 223)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const runId = `run-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, event_type, task_id, agent_id, payload, created_at)
       VALUES ('default-tenant', 'operator_question', ?, 'agent-b30b', ?, '2026-11-07T00:00:00.000Z')`,
    ).run(runId, JSON.stringify({ question: "batch30b" }));

    const checkpoint = createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "agent-b30b",
      objective: "Unsupported event",
      nextSafeAction: "continue",
    });
    expect(checkpoint.provenanceAudit?.provenanceReceiptCount ?? 0).toBe(0);
    db.close();
  });

  it("auditReceiptFromRow skips rows missing checkpointHash (line 316)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const runId = `run-${randomUUID().slice(0, 8)}`;
    const checkpoint = createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "agent-b30b",
      objective: "Audit guard",
      nextSafeAction: "continue",
    });

    db.prepare(
      `INSERT INTO audit_entries
        (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
       VALUES
        ('default-tenant', 'agent-b30b', 'agent', 'agent.checkpoint.created', 'agent_checkpoint', ?, 'malformed', ?, '2026-11-07T00:00:01.000Z')`,
    ).run(
      `agent_checkpoint:${checkpoint.id}`,
      JSON.stringify({ entryHash: checkpoint.provenanceAudit?.entryHash }),
    );

    const chain = verifyCheckpointAuditChain(db, "default-tenant");
    expect(chain.valid).toBe(true);
    db.close();
  });

  it("collectBoundaryProvenanceReceipts swallows missing efficiency table errors", () => {
    const db = new Database(":memory:");
    initSchema(db);
    db.exec("DROP TABLE efficiency_events");
    const runId = `run-${randomUUID().slice(0, 8)}`;
    const checkpoint = createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "agent-b30b",
      objective: "No efficiency table",
      nextSafeAction: "continue",
    });
    expect(checkpoint.provenanceAudit?.provenanceReceiptCount).toBe(0);
    db.close();
  });
});
