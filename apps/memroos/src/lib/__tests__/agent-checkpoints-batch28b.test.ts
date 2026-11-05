// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  createAgentCheckpoint,
  verifyCheckpointAuditChain,
} from "@/lib/agent-checkpoints";
import { initSchema } from "@/lib/db-schema";

afterEach(() => {
  // per-test db.close()
});

describe("agent-checkpoints batch28b — source_read receipts and malformed decisions", () => {
  it("builds source_read provenance receipts from efficiency events", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const runId = `run-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, event_type, task_id, agent_id, payload, created_at)
       VALUES ('default-tenant', 'source_read', ?, 'agent-b28b', ?, '2026-11-03T00:00:00.000Z')`,
    ).run(
      runId,
      JSON.stringify({
        sourceId: "doc-b28b",
        sourceHash: "sha256:" + "a".repeat(64),
        toolId: "read_file",
      }),
    );

    const checkpoint = createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "agent-b28b",
      objective: "Source read receipt",
      nextSafeAction: "continue",
    });
    expect(checkpoint.provenanceAudit?.provenanceReceiptCount).toBe(1);
    db.close();
  });

  it("verifyCheckpointAuditChain stays valid when decisions JSON is malformed in audit metadata", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const runId = `run-${randomUUID().slice(0, 8)}`;
    const checkpoint = createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "agent-b28b",
      objective: "Audit chain",
      nextSafeAction: "continue",
      decisions: { step: "batch28b" },
    });
    db.prepare(
      `INSERT INTO audit_entries
        (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
       VALUES
        ('default-tenant', 'agent-b28b', 'agent', 'agent.checkpoint.created', 'agent_checkpoint', ?, 'malformed-decisions', ?, '2026-11-03T00:00:01.000Z')`,
    ).run(
      runId,
      JSON.stringify({
        checkpointHash: checkpoint.provenanceAudit?.checkpointHash,
        entryHash: checkpoint.provenanceAudit?.entryHash,
        decisions: "{bad-json",
      }),
    );
    const chain = verifyCheckpointAuditChain(db, "default-tenant");
    expect(chain.valid).toBe(true);
    db.close();
  });
});
