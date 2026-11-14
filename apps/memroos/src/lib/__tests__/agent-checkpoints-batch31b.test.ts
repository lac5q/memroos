// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createAgentCheckpoint } from "@/lib/agent-checkpoints";
import { initSchema } from "@/lib/db-schema";

afterEach(() => {
  // per-test db.close()
});

describe("agent-checkpoints batch31b — receipt kinds and audit parsing", () => {
  it("buildReceipt maps retrieval_trace efficiency events (line 223)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const runId = `run-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, event_type, task_id, agent_id, payload, created_at)
       VALUES ('default-tenant', 'retrieval_trace', ?, 'agent-b31b', ?, '2026-11-08T00:00:00.000Z')`,
    ).run(
      runId,
      JSON.stringify({ query: "batch31b recall", sources: ["vault:art-1", "vault:art-2"] }),
    );

    const checkpoint = createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "agent-b31b",
      objective: "Retrieval trace receipt",
      nextSafeAction: "continue",
    });
    expect(checkpoint.provenanceAudit?.provenanceReceiptCount).toBe(1);
    db.close();
  });

  it("buildReceipt returns null for unsupported operator_question events (line 223)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const runId = `run-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, event_type, task_id, agent_id, payload, created_at)
       VALUES ('default-tenant', 'operator_question', ?, 'agent-b31b', ?, '2026-11-08T00:00:00.000Z')`,
    ).run(runId, JSON.stringify({ question: "batch31b unsupported" }));

    const checkpoint = createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "agent-b31b",
      objective: "Unsupported operator event",
      nextSafeAction: "continue",
    });
    expect(checkpoint.provenanceAudit?.provenanceReceiptCount ?? 0).toBe(0);
    db.close();
  });
});
