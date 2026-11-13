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

describe("agent-context-packet batch24 — context_id goals, handoffs, ontology deny", () => {
  it("resolves goals via hive_delegations.context_id and includes handoff packs", () => {
    const contextId = `ctx-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO hive_delegations
         (task_id, context_id, from_agent, to_agent, task_summary, status, created_at, updated_at)
       VALUES ('task-hidden', ?, 'director', 'worker', 'Context goal', 'active', datetime('now'), datetime('now'))`,
    ).run(contextId);
    db.prepare(
      `INSERT INTO agent_handoff_packs
         (id, tenant_id, task_id, title, context_pack_json, source_capture_ids_json)
       VALUES (?, 'default-tenant', ?, 'Handoff', ?, '[]')`,
    ).run(
      `handoff-${randomUUID()}`,
      contextId,
      JSON.stringify({ goalId: contextId, resume_marker: "resume-b24", note: "batch24" }),
    );

    const built = buildAgentContextPacket(db, {
      goalId: contextId,
      actorAgentId: "codex-cli-agent",
      lane: "ops",
      goalTitle: "Context id goal",
    });
    expect(built.packet.goal.status).toBe("active");
    expect(built.ledger.handoffs.some((h) => h.resumeMarker === "resume-b24")).toBe(true);
  });

  it("denies ontology injection when candidate metadata reference is malformed", () => {
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
       VALUES (?, 'default-tenant', ?, 'codex', 'lesson', 'body', ?, 'candidate', 'candidate', ?, ?)`,
    ).run(
      candidateId,
      captureId,
      "f".repeat(64),
      JSON.stringify({ goalId, ontologyReference: { broken: true } }),
      new Date().toISOString(),
    );

    const built = buildAgentContextPacket(db, {
      goalId,
      actorAgentId: "codex-cli-agent",
      lane: "memory",
      goalTitle: "Ontology deny",
    });
    const memory = built.packet.memories.find((m) => m.id === candidateId);
    expect(memory?.authorization).toBe("denied");
  });
});
