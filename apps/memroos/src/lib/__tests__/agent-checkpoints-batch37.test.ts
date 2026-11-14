// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { createAgentCheckpoint, resumeFromCheckpoint } from "@/lib/agent-checkpoints";
import { initSchema } from "@/lib/db-schema";

describe("agent-checkpoints batch37 — resume rollback notes and json defaults", () => {
  it("resumeFromCheckpoint preserves rollback_notes when present (636-637)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const runId = `run-rollback-b37-${randomUUID().slice(0, 8)}`;
    createAgentCheckpoint(db, {
      runId,
      ownerAgentId: "agent-b37",
      objective: "Rollback notes batch37",
      nextSafeAction: "pause",
      rollbackNotes: "If batch37 fails, revert migration",
    });
    const resumed = resumeFromCheckpoint(db, "default-tenant", runId);
    expect(resumed?.rollbackNotes).toMatch(/revert migration/i);
    db.close();
  });

  it("resumeFromCheckpoint defaults missing json columns to empty structures (630-634)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const runId = `run-json-b37-${randomUUID().slice(0, 8)}`;
    const checkpointId = randomUUID();
    db.prepare(
      `INSERT INTO agent_checkpoints
         (id, tenant_id, run_id, owner_agent_id, objective, next_safe_action, created_at)
       VALUES (?, 'default-tenant', ?, 'agent-b37', 'Sparse row batch37', 'continue', datetime('now'))`,
    ).run(checkpointId, runId);
    const resumed = resumeFromCheckpoint(db, "default-tenant", runId);
    expect(resumed?.completedSteps).toEqual([]);
    expect(resumed?.remainingSteps).toEqual([]);
    expect(resumed?.decisions).toEqual({});
    expect(resumed?.artifactRefs).toEqual([]);
    expect(resumed?.verificationState).toEqual({});
    db.close();
  });
});