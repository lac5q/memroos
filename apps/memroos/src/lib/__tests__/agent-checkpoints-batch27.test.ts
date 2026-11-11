// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createAgentCheckpoint,
  getCheckpointMetrics,
  verifyCheckpointAuditChain,
} from "@/lib/agent-checkpoints";
import { initSchema } from "@/lib/db-schema";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("agent-checkpoints batch27 — parseJson, unknown events, audit receipt guard", () => {
  it("parseJsonRecord treats malformed efficiency payloads as empty objects", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const runId = `run-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, event_type, task_id, agent_id, payload, created_at)
       VALUES ('default-tenant', 'memory_write', ?, 'agent-b27', ?, '2026-11-03T00:00:00.000Z')`,
    ).run(runId, "{not-json");

    const checkpoint = createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "agent-b27",
      objective: "Malformed payload",
      nextSafeAction: "continue",
    });
    expect(checkpoint.provenanceAudit?.provenanceReceiptCount).toBe(1);
    db.close();
  });

  it("skips operator_question events when building provenance receipts", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const runId = `run-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, event_type, task_id, agent_id, payload, created_at)
       VALUES ('default-tenant', 'operator_question', ?, 'agent-b27', ?, '2026-11-03T00:00:00.000Z')`,
    ).run(runId, JSON.stringify({ question: "batch27" }));

    const checkpoint = createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "agent-b27",
      objective: "Unsupported event",
      nextSafeAction: "continue",
    });
    expect(checkpoint.provenanceAudit?.provenanceReceiptCount ?? 0).toBe(0);
    db.close();
  });

  it("verifyCheckpointAuditChain skips audit rows missing checkpointHash", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const runId = `run-${randomUUID().slice(0, 8)}`;
    createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "agent-b27",
      objective: "Audit guard",
      nextSafeAction: "continue",
    });

    db.prepare(
      `INSERT INTO audit_entries
        (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
       VALUES
        ('default-tenant', 'agent-b27', 'agent', 'agent.checkpoint.created', 'agent_checkpoint', ?, 'missing-checkpoint-hash', ?, '2026-11-03T00:00:01.000Z')`,
    ).run(runId, JSON.stringify({ entryHash: "only-entry-hash-b27" }));

    const chain = verifyCheckpointAuditChain(db, "default-tenant");
    expect(chain.valid).toBe(true);
    expect(getCheckpointMetrics(db, "default-tenant").avgCheckpointSize).toBeGreaterThanOrEqual(0);
    db.close();
  });

  it("builds memory_write receipts when payload sources is not an array", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const runId = `run-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, event_type, task_id, agent_id, payload, created_at)
       VALUES ('default-tenant', 'retrieval_trace', ?, 'agent-b27', ?, '2026-11-03T00:00:00.000Z')`,
    ).run(runId, JSON.stringify({ sources: "not-an-array", query: "batch27" }));

    const checkpoint = createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "agent-b27",
      objective: "Non-array sources",
      nextSafeAction: "continue",
    });
    expect(checkpoint.provenanceAudit?.provenanceReceiptCount).toBe(1);
    db.close();
  });
});
