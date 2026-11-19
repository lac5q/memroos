// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { createAgentCheckpoint, verifyCheckpointAuditChain } from "@/lib/agent-checkpoints";

describe("long-tail batch15b — lib leftovers", () => {
  it("verifyCheckpointAuditChain reports valid empty chain", () => {
    const db = new Database(":memory:");
    initSchema(db);
    expect(verifyCheckpointAuditChain(db, "default-tenant")).toMatchObject({
      valid: true,
      checked: 0,
    });
    db.close();
  });

  it("createAgentCheckpoint stores normalized verification arrays", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const cp = createAgentCheckpoint(db, {
      runId: `run-${randomUUID().slice(0, 8)}`,
      ownerAgentId: "agent-a",
      objective: "batch15b checkpoint",
      nextSafeAction: "continue",
      verificationState: { checks: ["lint", "tests"] } as unknown as Record<string, unknown>,
    });
    expect(cp.verificationState).toEqual({ checks: ["lint", "tests"] });
    const chain = verifyCheckpointAuditChain(db, "default-tenant");
    expect(chain.valid).toBe(true);
    expect(chain.checked).toBeGreaterThanOrEqual(1);
    db.close();
  });
});
