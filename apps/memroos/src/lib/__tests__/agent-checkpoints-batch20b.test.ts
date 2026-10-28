// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  createAgentCheckpoint,
  getCheckpointMetrics,
  resumeFromCheckpoint,
  verifyCheckpointAuditChain,
} from "@/lib/agent-checkpoints";
import { initSchema } from "@/lib/db-schema";

describe("agent-checkpoints batch20b", () => {
  it("getCheckpointMetrics returns zeroed defaults on empty database", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const metrics = getCheckpointMetrics(db, "default-tenant");
    expect(metrics.avgWriteLatencyMs).toBe(0);
    expect(metrics.avgCheckpointSize).toBe(0);
    db.close();
  });

  it("resumeFromCheckpoint returns null when run has no checkpoints", () => {
    const db = new Database(":memory:");
    initSchema(db);
    expect(resumeFromCheckpoint(db, "default-tenant", `missing-${randomUUID()}`)).toBeNull();
    db.close();
  });

  it("verifyCheckpointAuditChain validates as empty when no checkpoint audit rows exist", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const chain = verifyCheckpointAuditChain(db, "default-tenant");
    expect(chain.valid).toBe(true);
    expect(chain.checked).toBe(0);
    db.close();
  });
});
