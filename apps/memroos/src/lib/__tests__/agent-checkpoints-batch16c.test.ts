// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  createAgentCheckpoint,
  getCheckpointMetrics,
  resumeFromCheckpoint,
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

describe("agent-checkpoints batch16c — listing and metrics defaults", () => {
  it("resumeFromCheckpoint returns null for unknown run", () => {
    const database = freshDb();
    expect(resumeFromCheckpoint(database, "default-tenant", `run-${crypto.randomUUID()}`)).toBeNull();
  });

  it("getCheckpointMetrics returns zeroed counters on empty tenant", () => {
    const database = freshDb();
    const metrics = getCheckpointMetrics(database, "default-tenant");
    expect(metrics.avgWriteLatencyMs).toBe(0);
    expect(metrics.duplicateWorkAvoided).toBe(0);
  });

  it("createAgentCheckpoint rejects missing objective", () => {
    const database = freshDb();
    expect(() =>
      createAgentCheckpoint(database, {
        runId: "run-1",
        ownerAgentId: "agent-1",
        objective: "  ",
        nextSafeAction: "wait",
      }),
    ).toThrow(/objective is required/);
  });
});
