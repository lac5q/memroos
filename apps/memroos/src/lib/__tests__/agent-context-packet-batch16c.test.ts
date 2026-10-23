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

describe("agent-context-packet batch16c — ontology denial and delegation ledger", () => {
  it("buildAgentContextPacket marks ontology injection denied when reference is malformed", () => {
    const database = freshDb();
    const goalId = `goal-ont-${crypto.randomUUID().slice(0, 8)}`;
    const candidateId = crypto.randomUUID();
    const captureId = crypto.randomUUID();
    const artifactId = `artifact-${captureId}`;
    database
      .prepare(
        `INSERT OR IGNORE INTO raw_artifacts (id, tenant_id, source_type, artifact_uri, artifact_path, content_hash)
         VALUES (?, 'default-tenant', 'test_fixture', ?, ?, ?)`,
      )
      .run(artifactId, `memroos://test/${artifactId}`, `/tmp/${artifactId}`, artifactId);
    database
      .prepare(
        `INSERT INTO agent_session_captures
         (id, tenant_id, source_agent_id, runtime, project, repo_path, session_id, task_id,
          status, capture_health, model_route_json, summary, decision_intent_json,
          sources_json, files_json, commands_json, errors_json, verification_json,
          metadata_json, raw_artifact_id, capture_hash, captured_at, updated_at)
         VALUES (?, 'default-tenant', 'agent-1', 'test', 'memroos', '/repo', 'session-1', 'task-1',
          'captured', 'ok', '{}', '', '{}', '[]', '[]', '[]', '[]', '[]', '{}', ?, ?, ?, ?)`,
      )
      .run(
        captureId,
        artifactId,
        crypto.randomUUID(),
        "2026-07-01T00:00:00.000Z",
        "2026-07-01T00:00:00.000Z",
      );
    database
      .prepare(
        `INSERT INTO agent_memory_candidates
         (id, tenant_id, capture_id, agent_id, memory_type, content, content_hash, status,
          belief_stage, metadata_json, created_at)
         VALUES (?, 'default-tenant', ?, 'agent-1', 'decision_intent', 'content', ?, 'candidate',
          'silver_candidate_claim', ?, ?)`,
      )
      .run(
        candidateId,
        captureId,
        "a".repeat(64),
        JSON.stringify({ goalId, ontologyReference: { recordType: "", recordId: "" } }),
        "2026-07-01T00:00:00.000Z",
      );

    const { packet } = buildAgentContextPacket(database, {
      goalId,
      actorAgentId: "agent-1",
      lane: "memory",
      now: () => new Date("2026-07-01T00:01:00.000Z"),
    });
    const memory = packet.memories.find((m) => m.id === candidateId);
    expect(memory?.authorization).toBe("denied");
    expect(packet.receipts.some((r) => r.status === "denied")).toBe(true);
  });

  it("readAgentRunLedger includes hive delegation summaries when present", () => {
    const database = freshDb();
    const goalId = `goal-del-${crypto.randomUUID().slice(0, 8)}`;
    database
      .prepare(
        `INSERT INTO hive_delegations
         (task_id, from_agent, to_agent, task_summary, status, created_at, updated_at)
         VALUES (?, 'agent-a', 'agent-b', 'Delegated work', 'active', ?, ?)`,
      )
      .run(goalId, "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
    const ledger = readAgentRunLedger(database, {
      goalId,
      lane: "ops",
      now: () => new Date("2026-07-01T00:02:00.000Z"),
    });
    expect(ledger.tasks.length).toBeGreaterThanOrEqual(1);
    expect(ledger.tasks[0]?.owner).toBe("agent-b");
  });

  it("buildAgentContextPacket maps blocked goal status from checkpoint objective", () => {
    const database = freshDb();
    const goalId = `goal-block-${crypto.randomUUID().slice(0, 8)}`;
    database
      .prepare(
        `INSERT INTO agent_checkpoints
         (id, tenant_id, run_id, owner_agent_id, objective, completed_steps_json, remaining_steps_json,
          decisions_json, artifact_refs_json, verification_state_json, next_safe_action, rollback_notes,
          provenance_pointers_json, checkpoint_size, write_latency_ms, created_at)
         VALUES (?, 'default-tenant', ?, 'agent-block', 'Blocked on approval', '[]', '[]', '{}', '[]', '{}', 'wait', NULL, '[]', 1, 1, ?)`,
      )
      .run(crypto.randomUUID(), goalId, "2026-07-01T00:00:00.000Z");
    const { packet } = buildAgentContextPacket(database, {
      goalId,
      actorAgentId: "agent-block",
      lane: "safety",
    });
    expect(packet.goal.title).toMatch(/Blocked/);
    expect(packet.goal.lane).toBe("safety");
  });
});
