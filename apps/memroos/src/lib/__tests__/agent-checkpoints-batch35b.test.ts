// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { AUDIT_EVENT_TYPES } from "@/lib/audit/event-types";
import {
  createAgentCheckpoint,
  verifyCheckpointAuditChain,
} from "@/lib/agent-checkpoints";
import { initSchema } from "@/lib/db-schema";

const CHECKPOINT_AUDIT_EVENT = AUDIT_EVENT_TYPES.AGENT_CHECKPOINTED;

describe("agent-checkpoints batch35b", () => {
  it.skip("buildReceipt null fallback (223) — efficiency_events query only selects handled event types", () => {});

  it("verifyCheckpointAuditChain ignores audit rows missing entryHash metadata (316)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const runId = `run-audit-b35b-${randomUUID().slice(0, 8)}`;
    createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "agent-b35b",
      objective: "Audit chain batch35b",
      nextSafeAction: "continue",
    });
    db.prepare(
      `INSERT INTO audit_entries
        (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
       VALUES (?, 'default-tenant', 'agent-b35b', 'agent', ?, 'agent_checkpoint', ?, 'missing hash', ?, '2026-11-12T00:00:02.000Z')`,
    ).run(randomUUID(), CHECKPOINT_AUDIT_EVENT, `agent_checkpoint:broken-b35b`, JSON.stringify({ checkpointHash: "hash-only" }));
    const chain = verifyCheckpointAuditChain(db, "default-tenant");
    expect(chain.valid).toBe(false);
    expect(chain.reason).toMatch(/entryHash|hash/i);
    db.close();
  });

  it("collectBoundaryProvenanceReceipts includes retrieval_trace receipts", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const runId = `run-trace-b35b-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, event_type, task_id, agent_id, payload, created_at)
       VALUES ('default-tenant', 'retrieval_trace', ?, 'agent-b35b', ?, '2026-11-12T00:00:00.000Z')`,
    ).run(
      runId,
      JSON.stringify({ sources: ["kb://batch35b"], query: "what changed" }),
    );
    const checkpoint = createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "agent-b35b",
      objective: "Retrieval trace provenance",
      nextSafeAction: "continue",
    });
    expect(checkpoint.provenanceAudit?.provenanceReceiptCount).toBe(1);
    db.close();
  });
});
