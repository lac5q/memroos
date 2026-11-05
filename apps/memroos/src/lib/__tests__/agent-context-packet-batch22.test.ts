// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildAgentContextPacket } from "@/lib/agent-context-packet";
import { initSchema } from "@/lib/db-schema";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  initSchema(db);
});

afterEach(() => {
  db.close();
});

describe("agent-context-packet batch22 — belief stages, authz, ledger branches", () => {
  it("maps unknown belief_stage on non-promoted candidates to silver_candidate_claim", () => {
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
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
       VALUES (?, 'default-tenant', 'codex', 'test', 'memroos', '/repo', 's', 't',
               'captured', 'ok', '{}', '', '{}', '[]', '[]', '[]', '[]', '[]', '{}', ?, ?, ?, ?)`,
    ).run(captureId, artifactId, randomUUID(), new Date().toISOString(), new Date().toISOString());
    const candidateId = randomUUID();
    db.prepare(
      `INSERT INTO agent_memory_candidates
         (id, tenant_id, capture_id, agent_id, memory_type, content, content_hash, status,
          belief_stage, metadata_json, created_at)
       VALUES (?, 'default-tenant', ?, 'codex', 'lesson', 'body', ?, 'candidate', 'legacy_stage', ?, ?)`,
    ).run(candidateId, captureId, "e".repeat(64), JSON.stringify({ goalId, authorization: "denied" }), new Date().toISOString());

    const built = buildAgentContextPacket(db, {
      goalId,
      actorAgentId: "codex-cli-agent",
      lane: "memory",
      goalTitle: "Authz branch",
    });
    const memory = built.packet.memories.find((m) => m.id === candidateId);
    expect(memory?.beliefStage).toBe("silver_candidate_claim");
    expect(memory?.authorization).toBe("denied");
  });

  it("readAgentRunLedger maps completed delegations and url artifacts", () => {
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO hive_delegations
         (task_id, from_agent, to_agent, task_summary, status, created_at, updated_at)
       VALUES (?, 'director', 'worker', 'Ledger branches task', 'completed', datetime('now'), datetime('now'))`,
    ).run(goalId);
    db.prepare(
      `INSERT INTO hive_actions (agent_id, action_type, summary, artifacts, timestamp)
       VALUES ('worker', 'checkpoint', 'shipped', ?, datetime('now'))`,
    ).run(JSON.stringify({ goalId, url: "https://example.com/artifact", kind: "url" }));
    db.prepare(
      `INSERT INTO audit_entries
         (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
       VALUES ('default-tenant', 'operator', 'operator', 'policy_bypass_requested', 'goal', ?, 'manual bypass', '{}', datetime('now'))`,
    ).run(goalId);

    const built = buildAgentContextPacket(db, {
      goalId,
      actorAgentId: "codex-cli-agent",
      lane: "ops",
      goalTitle: "Ledger branches",
    });
    expect(built.packet.goal.status).toBe("complete");
    expect(built.ledger.artifacts.some((a) => a.kind === "url")).toBe(true);
    expect(built.ledger.approvals.some((a) => a.status === "bypassed")).toBe(true);
  });
});
