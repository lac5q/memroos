// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildAgentContextPacket, readAgentRunLedger } from "../agent-context-packet";

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

describe("agent-context-packet batch16b — guards and ledger assembly", () => {
  it("buildAgentContextPacket rejects blank goal and actor ids", () => {
    const database = freshDb();
    expect(() =>
      buildAgentContextPacket(database, {
        goalId: "  ",
        actorAgentId: "agent-1",
        lane: "code",
      }),
    ).toThrow(/goalId is required/);
    expect(() =>
      buildAgentContextPacket(database, {
        goalId: "goal-1",
        actorAgentId: "",
        lane: "code",
      }),
    ).toThrow(/actorAgentId is required/);
  });

  it("buildAgentContextPacket includes checkpoint-derived verification constraints", () => {
    const database = freshDb();
    const goalId = `goal-acp-${crypto.randomUUID().slice(0, 8)}`;
    database
      .prepare(
        `INSERT INTO agent_checkpoints
         (id, tenant_id, run_id, owner_agent_id, objective, completed_steps_json, remaining_steps_json,
          decisions_json, artifact_refs_json, verification_state_json, next_safe_action, rollback_notes,
          provenance_pointers_json, checkpoint_size, write_latency_ms, created_at)
         VALUES (?, 'default-tenant', ?, 'agent-ctx', 'Objective', '[]', '[]', '{}', '[]', ?, 'continue', NULL, '[]', 10, 1, ?)`,
      )
      .run(
        crypto.randomUUID(),
        goalId,
        JSON.stringify({ proof_receipt: "present" }),
        "2026-07-01T12:00:00.000Z",
      );
    const { packet, ledger } = buildAgentContextPacket(database, {
      goalId,
      actorAgentId: "agent-ctx",
      lane: "memory",
      now: () => new Date("2026-07-01T12:01:00.000Z"),
    });
    expect(packet.goal.id).toBe(goalId);
    expect(packet.packetHash).toMatch(/^sha256:/);
    expect(ledger.goalId).toBe(goalId);
    expect(packet.constraints.requiredVerification.length).toBeGreaterThanOrEqual(0);
  });

  it("readAgentRunLedger returns empty collections for unknown goal", () => {
    const database = freshDb();
    const ledger = readAgentRunLedger(database, {
      goalId: `missing-${crypto.randomUUID().slice(0, 8)}`,
      lane: "ops",
    });
    expect(ledger.tasks).toEqual([]);
    expect(ledger.events).toEqual([]);
  });
});
