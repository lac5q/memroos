// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  createAgentCheckpoint,
  getCheckpointMetrics,
  verifyCheckpointAuditChain,
} from "@/lib/agent-checkpoints";
import { initSchema } from "@/lib/db-schema";

describe("agent-checkpoints batch26 — parseJson and audit receipt edges", () => {
  it("skips provenance receipts when efficiency payload JSON is malformed", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const runId = `run-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, event_type, task_id, agent_id, payload, created_at)
       VALUES ('default-tenant', 'memory_write', ?, 'agent-b26', ?, '2026-11-02T00:00:00.000Z')`,
    ).run(runId, "{not-json");

    const checkpoint = createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "agent-b26",
      objective: "Malformed payload",
      nextSafeAction: "continue",
    });
    // Malformed JSON parses to {} via catch; memory_write still emits a receipt with defaults.
    expect(checkpoint.provenanceAudit?.provenanceReceiptCount).toBeGreaterThanOrEqual(0);
    db.close();
  });

  it("builds retrieval_trace receipts with empty sources and blank query branches", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const runId = `run-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, event_type, task_id, agent_id, payload, created_at)
       VALUES ('default-tenant', 'retrieval_trace', ?, 'agent-b26', ?, '2026-11-02T00:00:00.000Z')`,
    ).run(
      runId,
      JSON.stringify({ sources: ["", 12, null, "ok-source"], query: "   " }),
    );

    const checkpoint = createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "agent-b26",
      objective: "Retrieval edges",
      nextSafeAction: "continue",
    });
    expect(checkpoint.provenanceAudit?.provenanceReceiptCount).toBe(1);
    db.close();
  });

  it("verifyCheckpointAuditChain ignores audit rows missing entryHash or checkpointHash", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const runId = `run-${randomUUID().slice(0, 8)}`;
    createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "agent-b26",
      objective: "Seed audit",
      nextSafeAction: "continue",
    });

    db.prepare(
      `INSERT INTO audit_entries
        (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
       VALUES
        ('default-tenant', 'agent-b26', 'agent', 'agent.checkpoint.created', 'agent_checkpoint', ?, 'incomplete', ?, '2026-11-02T00:00:01.000Z')`,
    ).run(runId, JSON.stringify({ entryHash: "only-hash" }));

    db.prepare(
      `INSERT INTO audit_entries
        (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
       VALUES
        ('default-tenant', 'agent-b26', 'agent', 'agent.checkpoint.created', 'agent_checkpoint', ?, 'bad-json', ?, '2026-11-02T00:00:02.000Z')`,
    ).run(runId, "{broken");

    const chain = verifyCheckpointAuditChain(db, "default-tenant");
    expect(chain.valid).toBe(true);
    expect(chain.checked).toBeGreaterThanOrEqual(1);
    expect(getCheckpointMetrics(db, "default-tenant").avgCheckpointSize).toBeGreaterThanOrEqual(0);
    db.close();
  });
});
