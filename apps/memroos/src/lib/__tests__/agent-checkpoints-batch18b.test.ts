// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { createAgentCheckpoint, getCheckpointMetrics } from "../agent-checkpoints";

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

describe("agent-checkpoints batch18b", () => {
  it("createAgentCheckpoint rejects blank objective", () => {
    const database = freshDb();
    expect(() =>
      createAgentCheckpoint(database, {
        runId: "run-b18b",
        ownerAgentId: "agent-1",
        objective: "   ",
        nextSafeAction: "pause",
      }),
    ).toThrow(/objective is required/);
  });

  it("getCheckpointMetrics reflects persisted checkpoint rows", () => {
    const database = freshDb();
    const runId = `run-list-${crypto.randomUUID().slice(0, 8)}`;
    createAgentCheckpoint(database, {
      runId,
      ownerAgentId: "agent-list",
      objective: "Batch18b checkpoint metrics",
      nextSafeAction: "verify audit chain",
    });
    const metrics = getCheckpointMetrics(database, "default-tenant");
    expect(metrics.avgCheckpointSize).toBeGreaterThan(0);
  });
});
