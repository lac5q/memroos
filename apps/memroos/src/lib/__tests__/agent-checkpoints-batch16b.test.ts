// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  createAgentCheckpoint,
  getCheckpointMetrics,
  resumeFromCheckpoint,
  verifyCheckpointAuditChain,
} from "../agent-checkpoints";

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

describe("agent-checkpoints batch16b — validation, resume, audit chain", () => {
  it("createAgentCheckpoint requires core fields", () => {
    const database = freshDb();
    expect(() =>
      createAgentCheckpoint(database, {
        runId: "",
        ownerAgentId: "agent-1",
        objective: "obj",
        nextSafeAction: "wait",
      }),
    ).toThrow(/runId is required/);
    expect(() =>
      createAgentCheckpoint(database, {
        runId: "run-1",
        ownerAgentId: " ",
        objective: "obj",
        nextSafeAction: "wait",
      }),
    ).toThrow(/ownerAgentId is required/);
  });

  it("duplicate checkpoints increment duplicateWorkAvoided metric", () => {
    const database = freshDb();
    const runId = `run-dup-${crypto.randomUUID().slice(0, 8)}`;
    const base = {
      runId,
      ownerAgentId: "agent-dup",
      objective: "Ship batch16b",
      completedSteps: ["plan"],
      remainingSteps: ["verify"],
      decisions: { lane: "code" },
      nextSafeAction: "run vitest",
    };
    createAgentCheckpoint(database, base);
    createAgentCheckpoint(database, base);
    const metrics = getCheckpointMetrics(database, "default-tenant");
    expect(metrics.duplicateWorkAvoided).toBeGreaterThanOrEqual(1);
  });

  it("resumeFromCheckpoint returns latest row for run", () => {
    const database = freshDb();
    const runId = `run-resume-${crypto.randomUUID().slice(0, 8)}`;
    const first = createAgentCheckpoint(database, {
      runId,
      ownerAgentId: "agent-resume",
      objective: "First",
      nextSafeAction: "step-1",
    });
    const second = createAgentCheckpoint(database, {
      runId,
      ownerAgentId: "agent-resume",
      objective: "Second",
      nextSafeAction: "step-2",
    });
    database.prepare(`UPDATE agent_checkpoints SET created_at = ? WHERE id = ?`).run("2026-07-01T00:00:00.000Z", first.id);
    database.prepare(`UPDATE agent_checkpoints SET created_at = ? WHERE id = ?`).run("2026-07-02T00:00:00.000Z", second.id);
    const resumed = resumeFromCheckpoint(database, "default-tenant", runId);
    expect(resumed?.objective).toBe("Second");
    expect(resumed?.nextSafeAction).toBe("step-2");
  });

  it("verifyCheckpointAuditChain validates linked checkpoint audit rows", () => {
    const database = freshDb();
    createAgentCheckpoint(database, {
      runId: `run-audit-${crypto.randomUUID().slice(0, 8)}`,
      ownerAgentId: "agent-audit",
      objective: "Audit chain",
      nextSafeAction: "verify",
    });
    const verification = verifyCheckpointAuditChain(database, "default-tenant");
    expect(verification.valid).toBe(true);
    expect(verification.checked).toBeGreaterThanOrEqual(1);
  });
});
