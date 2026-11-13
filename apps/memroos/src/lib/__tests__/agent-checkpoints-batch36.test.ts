// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { AUDIT_EVENT_TYPES, ENTITY_TYPES } from "@/lib/audit/event-types";
import { createAgentCheckpoint, resumeFromCheckpoint } from "@/lib/agent-checkpoints";
import { initSchema } from "@/lib/db-schema";

const CHECKPOINT_AUDIT_EVENT = AUDIT_EVENT_TYPES.AGENT_CHECKPOINTED;
const CHECKPOINT_AUDIT_ENTITY = ENTITY_TYPES.AGENT_CHECKPOINT;

describe("agent-checkpoints batch36", () => {
  it.skip("buildReceipt final null arm (223) — query never selects unhandled event types", () => {});

  it("auditReceiptFromRow rejects metadata missing entryHash (316)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const runId = `run-audit-b36-${randomUUID().slice(0, 8)}`;
    const checkpoint = createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "agent-b36",
      objective: "Audit receipt batch36",
      nextSafeAction: "continue",
    });
    expect(checkpoint.provenanceAudit?.entryHash).toBeTruthy();
    db.prepare(
      `INSERT INTO audit_entries
        (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
       VALUES (?, 'default-tenant', 'agent-b36', 'system', ?, ?, ?, 'missing hash row', ?, '2026-11-13T00:00:05.000Z')`,
    ).run(
      randomUUID(),
      CHECKPOINT_AUDIT_EVENT,
      CHECKPOINT_AUDIT_ENTITY,
      `agent_checkpoint:${checkpoint.id}`,
      JSON.stringify({ checkpointHash: checkpoint.provenanceAudit?.checkpointHash }),
    );
    const resumed = resumeFromCheckpoint(db, "default-tenant", runId);
    expect(resumed?.provenanceAudit).toBeNull();
    db.close();
  });

  it("collectBoundaryProvenanceReceipts filters unknown efficiency event payloads", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const runId = `run-unknown-b36-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, event_type, task_id, agent_id, payload, created_at)
       VALUES ('default-tenant', 'operator_question', ?, 'agent-b36', ?, '2026-11-13T00:00:00.000Z')`,
    ).run(runId, JSON.stringify({ questionText: "orphan batch36" }));
    const checkpoint = createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "agent-b36",
      objective: "Unknown event filtered",
      nextSafeAction: "continue",
    });
    expect(checkpoint.provenanceAudit?.provenanceReceiptCount).toBe(0);
    db.close();
  });
});
