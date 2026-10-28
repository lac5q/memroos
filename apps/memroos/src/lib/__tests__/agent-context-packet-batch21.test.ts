// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { buildAgentContextPacket } from "@/lib/agent-context-packet";
import { createOrResumeGsdGoal } from "@/lib/agent-gsd-control";
import { initSchema } from "@/lib/db-schema";

const db = new Database(":memory:");
initSchema(db);

function insertCaptureForCandidate(): string {
  const captureId = randomUUID();
  const artifactId = `artifact-${captureId}`;
  db.prepare(
    `INSERT OR IGNORE INTO raw_artifacts (id, tenant_id, source_type, artifact_uri, artifact_path, content_hash)
     VALUES (?, 'default-tenant', 'test_fixture', ?, ?, ?)`,
  ).run(artifactId, `memroos://test/${artifactId}`, `/tmp/${artifactId}`, artifactId);
  db.prepare(
    `INSERT INTO agent_session_captures
       (id, tenant_id, source_agent_id, runtime, project, repo_path, session_id, task_id,
        status, capture_health, model_route_json, summary, decision_intent_json,
        sources_json, files_json, commands_json, errors_json, verification_json,
        metadata_json, raw_artifact_id, capture_hash, captured_at, updated_at)
     VALUES (?, 'default-tenant', 'codex', 'test', 'memroos', '/repo', 'session-1', 'task-1',
             'captured', 'ok', '{}', '', '{}', '[]', '[]', '[]', '[]', '[]', '{}', ?, ?, ?, ?)`,
  ).run(captureId, artifactId, randomUUID(), new Date().toISOString(), new Date().toISOString());
  return captureId;
}

afterEach(() => {
  db.prepare("DELETE FROM efficiency_events").run();
  db.prepare("DELETE FROM agent_memory_candidates").run();
  db.prepare("DELETE FROM agent_checkpoints").run();
  db.prepare("DELETE FROM hive_actions").run();
});

describe("agent-context-packet batch21 — safeJson, beliefs, maybeGet", () => {
  it("maps promoted candidates with unknown belief_stage to gold operational truth", () => {
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    createOrResumeGsdGoal(db, {
      goalId,
      title: "Belief stage default",
      actorAgentId: "codex-cli-agent",
      lane: "memory",
    });
    const captureId = insertCaptureForCandidate();
    const candidateId = randomUUID();
    db.prepare(
      `INSERT INTO agent_memory_candidates
         (id, tenant_id, capture_id, agent_id, memory_type, content, content_hash, status,
          belief_stage, metadata_json, created_at)
       VALUES (?, 'default-tenant', ?, 'codex', 'lesson', 'body', ?, 'promoted', 'legacy_unknown_stage', ?, ?)`,
    ).run(
      candidateId,
      captureId,
      "d".repeat(64),
      JSON.stringify({ title: "Promoted note", goalId }),
      new Date().toISOString(),
    );
    const built = buildAgentContextPacket(db, {
      goalId,
      actorAgentId: "codex-cli-agent",
      lane: "memory",
      goalTitle: "Belief stage default",
    });
    const memory = built.packet.memories.find((m) => m.id === candidateId);
    expect(memory?.beliefStage).toBe("gold_operational_truth");
  });

  it("tolerates malformed JSON in hive action artifacts for receipts", () => {
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    createOrResumeGsdGoal(db, {
      goalId,
      title: "Bad artifacts",
      actorAgentId: "codex-cli-agent",
      lane: "ops",
    });
    db.prepare(
      `INSERT INTO hive_actions (agent_id, action_type, summary, artifacts, timestamp)
       VALUES ('codex-cli-agent', 'checkpoint', 'ship', '{not-json', datetime('now'))`,
    ).run();
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, task_id, agent_id, event_type, payload, created_at)
       VALUES ('default-tenant', ?, 'codex-cli-agent', 'token_ledger', '{broken', datetime('now'))`,
    ).run(goalId);
    const built = buildAgentContextPacket(db, {
      goalId,
      actorAgentId: "codex-cli-agent",
      lane: "ops",
      goalTitle: "Bad artifacts",
    });
    expect(built.packet.receipts.length).toBeGreaterThanOrEqual(0);
  });

  it("tolerates missing hive_delegations table when resolving latest delegation", () => {
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    db.exec("DROP TABLE IF EXISTS hive_delegations");
    const built = buildAgentContextPacket(db, {
      goalId,
      actorAgentId: "codex-cli-agent",
      lane: "ops",
      goalTitle: "No delegations table",
    });
    expect(built.packet.goal.id).toBe(goalId);
    initSchema(db);
  });
});
