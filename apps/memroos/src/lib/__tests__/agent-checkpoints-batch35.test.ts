// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { AUDIT_EVENT_TYPES } from "@/lib/audit/event-types";
import {
  createAgentCheckpoint,
  resumeFromCheckpoint,
  verifyCheckpointAuditChain,
} from "@/lib/agent-checkpoints";
import { initSchema } from "@/lib/db-schema";

const CHECKPOINT_AUDIT_EVENT = AUDIT_EVENT_TYPES.AGENT_CHECKPOINTED;

describe("agent-checkpoints batch35 — memory_write, audit chain, resume parsing", () => {
  it("buildReceipt maps memory_write efficiency events (184-200)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const runId = `run-mw-b35-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, event_type, task_id, agent_id, payload, created_at)
       VALUES ('default-tenant', 'memory_write', ?, 'agent-b35', ?, '2026-11-12T00:00:00.000Z')`,
    ).run(runId, JSON.stringify({ source: "kb://batch35", dedupHash: "dedup-b35" }));

    const checkpoint = createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "agent-b35",
      objective: "Memory write provenance",
      nextSafeAction: "continue",
    });
    expect(checkpoint.provenanceAudit?.provenanceReceiptCount).toBe(1);
    db.close();
  });

  it("verifyCheckpointAuditChain rejects rows missing entryHash (667-673)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    db.prepare(
      `INSERT INTO audit_entries
        (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
       VALUES
        (?, 'default-tenant', 'agent-b35', 'agent', ?, 'agent_checkpoint', 'agent_checkpoint:broken-b35', 'no entry hash', '{}', '2026-11-12T00:00:01.000Z')`,
    ).run(randomUUID(), CHECKPOINT_AUDIT_EVENT);
    const chain = verifyCheckpointAuditChain(db, "default-tenant");
    expect(chain.valid).toBe(false);
    expect(chain.reason).toMatch(/missing entryHash/i);
    db.close();
  });

  it("resumeFromCheckpoint coerces nullable rollback fields (630-637)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const runId = `run-resume-b35-${randomUUID().slice(0, 8)}`;
    const created = createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "agent-b35",
      objective: "Resume parsing batch35",
      nextSafeAction: "shipcheck",
      rollbackNotes: null,
    });
    const resumed = resumeFromCheckpoint(db, "default-tenant", runId);
    expect(resumed?.id).toBe(created.id);
    expect(resumed?.rollbackNotes).toBeNull();
    expect(Array.isArray(resumed?.completedSteps)).toBe(true);
    db.close();
  });
});
