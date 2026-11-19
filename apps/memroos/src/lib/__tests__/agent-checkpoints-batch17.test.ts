// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { AUDIT_EVENT_TYPES } from "@/lib/audit/event-types";
import { initSchema } from "@/lib/db-schema";
import { createAgentCheckpoint, verifyCheckpointAuditChain } from "../agent-checkpoints";

const CHECKPOINT_AUDIT_EVENT = AUDIT_EVENT_TYPES.AGENT_CHECKPOINTED;

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("agent-checkpoints batch17 — validation, provenance receipts, audit faults", () => {
  it("createAgentCheckpoint requires nextSafeAction", () => {
    const database = freshDb();
    expect(() =>
      createAgentCheckpoint(database, {
        runId: "run-1",
        ownerAgentId: "agent-1",
        objective: "Ship batch17",
        nextSafeAction: "  ",
      }),
    ).toThrow(/nextSafeAction is required/);
  });

  it("checkpoint audit collects efficiency boundary receipts for run", () => {
    const database = freshDb();
    const runId = `run-prov-${crypto.randomUUID().slice(0, 8)}`;
    const payload = JSON.stringify({ sourceId: "src-1", sourceHash: "sha256:abc", toolId: "read_file" });
    database
      .prepare(
        `INSERT INTO efficiency_events (tenant_id, event_type, task_id, agent_id, payload, created_at)
         VALUES ('default-tenant', 'source_read', ?, 'agent-prov', ?, '2026-07-10T00:00:00.000Z')`,
      )
      .run(runId, payload);
    database
      .prepare(
        `INSERT INTO efficiency_events (tenant_id, event_type, task_id, agent_id, payload, created_at)
         VALUES ('default-tenant', 'retrieval_trace', ?, 'agent-prov', ?, '2026-07-10T00:00:01.000Z')`,
      )
      .run(runId, JSON.stringify({ sources: ["mem-a", "mem-b"], query: "checkout" }));
    database
      .prepare(
        `INSERT INTO efficiency_events (tenant_id, event_type, task_id, agent_id, payload, created_at)
         VALUES ('default-tenant', 'token_ledger', ?, 'agent-prov', '{}', '2026-07-10T00:00:02.000Z')`,
      )
      .run(runId);

    const checkpoint = createAgentCheckpoint(database, {
      runId,
      ownerAgentId: "agent-prov",
      objective: "Collect provenance",
      nextSafeAction: "verify receipts",
    });
    expect(checkpoint.provenanceAudit?.provenanceReceiptCount).toBeGreaterThanOrEqual(2);
  });

  it("verifyCheckpointAuditChain fails on missing entryHash", () => {
    const database = freshDb();
    database
      .prepare(
        `INSERT INTO audit_entries
         (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
         VALUES (?, 'default-tenant', 'agent-audit', 'system', ?, 'agent_checkpoint', 'agent_checkpoint:bad', 'tampered', ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        CHECKPOINT_AUDIT_EVENT,
        JSON.stringify({ schemaVersion: 1, checkpointHash: "sha256:abc", previousEntryHash: null }),
        "2026-07-10T00:00:00.000Z",
      );
    const verification = verifyCheckpointAuditChain(database, "default-tenant");
    expect(verification.valid).toBe(false);
    expect(verification.reason).toMatch(/missing entryHash/);
  });

  it("verifyCheckpointAuditChain fails when recomputed hash does not match content", () => {
    const database = freshDb();
    database
      .prepare(
        `INSERT INTO audit_entries
         (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
         VALUES (?, 'default-tenant', 'agent-hash', 'system', ?, 'agent_checkpoint', 'agent_checkpoint:bad', 'tampered', ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        CHECKPOINT_AUDIT_EVENT,
        JSON.stringify({
          schemaVersion: 1,
          checkpointHash: "sha256:abc",
          previousEntryHash: null,
          entryHash: "sha256:deadbeef",
        }),
        "2026-07-10T00:00:00.000Z",
      );
    const verification = verifyCheckpointAuditChain(database, "default-tenant");
    expect(verification.valid).toBe(false);
    expect(verification.reason).toMatch(/hash does not match/);
  });
});
