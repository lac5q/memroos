// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildAgentContextPacket, readAgentRunLedger } from "@/lib/agent-context-packet";
import { initSchema } from "@/lib/db-schema";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  initSchema(db);
});

afterEach(() => {
  db.close();
});

describe("agent-context-packet batch34 — decisions, traces, efficiency, memory arms", () => {
  it("decisionsFrom maps object decisions to stable json summaries (281, 330)", () => {
    const goalId = `goal-b34-${randomUUID().slice(0, 8)}`;
    const checkpointId = randomUUID();
    db.prepare(
      `INSERT INTO agent_checkpoints
         (id, tenant_id, run_id, owner_agent_id, objective, artifact_refs_json, decisions_json, verification_state_json, next_safe_action, created_at)
       VALUES (?, 'default-tenant', ?, 'codex', 'batch34', '[]', ?, '{}', 'resume', datetime('now'))`,
    ).run(checkpointId, goalId, JSON.stringify({ ship: { lane: "ops", approved: true } }));
    const built = buildAgentContextPacket(db, { goalId, actorAgentId: "codex-cli-agent", lane: "ops" });
    expect(built.packet.decisions.some((d) => d.id === "ship")).toBe(true);
    expect(built.packet.decisions[0]?.summary).toContain("lane");
  });

  it("trace receipts use skipped status when no policy filters exist (317-323)", () => {
    const goalId = `goal-trace-b34-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO agent_memory_traces
         (id, tenant_id, run_id, task_id, agent_id, causal_path_json, created_at)
       VALUES (?, 'default-tenant', ?, ?, 'codex', ?, datetime('now'))`,
    ).run(randomUUID(), goalId, goalId, JSON.stringify({ hops: [] }));
    const built = buildAgentContextPacket(db, { goalId, actorAgentId: "codex-cli-agent", lane: "ops" });
    expect(
      built.packet.receipts.some((r) => r.source === "agent_memory_traces" && r.status === "skipped"),
    ).toBe(true);
  });

  it("efficiency receipts mark retrieval traces below threshold (332-336)", () => {
    const goalId = `goal-eff-b34-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, task_id, agent_id, event_type, payload, created_at)
       VALUES ('default-tenant', ?, 'codex', 'retrieval_trace', ?, datetime('now'))`,
    ).run(goalId, JSON.stringify({ sources: [] }));
    const built = buildAgentContextPacket(db, { goalId, actorAgentId: "codex-cli-agent", lane: "ops" });
    expect(
      built.packet.receipts.some((r) => r.source === "efficiency_events" && r.status === "below_threshold"),
    ).toBe(true);
  });

  it("artifactEntriesFromJson accepts string refs and hive action artifacts (289-299, 417-418)", () => {
    const goalId = `goal-art-b34-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO hive_actions (agent_id, action_type, summary, artifacts, timestamp)
       VALUES ('codex', 'checkpoint', 'artifact batch34', ?, datetime('now'))`,
    ).run(JSON.stringify({ taskId: goalId, path: "/tmp/proof-b34.txt" }));
    const ledger = readAgentRunLedger(db, { goalId, lane: "code" });
    expect(ledger.artifacts.some((a) => a.kind === "artifact" || a.kind === "path")).toBe(true);
  });

  it("memory entries expose denied authorization title fallback (657-670)", () => {
    const goalId = `goal-mem-b34-${randomUUID().slice(0, 8)}`;
    const captureId = randomUUID();
    const candidateId = randomUUID();
    db.prepare(
      `INSERT OR IGNORE INTO raw_artifacts (id, tenant_id, source_type, artifact_uri, artifact_path, content_hash)
       VALUES (?, 'default-tenant', 'test_fixture', ?, ?, ?)`,
    ).run(`art-${candidateId}`, `memroos://test/${candidateId}`, `/tmp/${candidateId}`, candidateId);
    db.prepare(
      `INSERT INTO agent_session_captures
         (id, tenant_id, source_agent_id, runtime, project, repo_path, session_id, task_id,
          status, capture_health, model_route_json, summary, decision_intent_json,
          sources_json, files_json, commands_json, errors_json, verification_json,
          metadata_json, raw_artifact_id, capture_hash, captured_at, updated_at)
       VALUES (?, 'default-tenant', 'codex', 'test', 'memroos', '/repo', 's', 't',
               'captured', 'ok', '{}', '', '{}', '[]', '[]', '[]', '[]', '[]', '{}', ?, ?, ?, ?)`,
    ).run(captureId, `art-${candidateId}`, randomUUID(), new Date().toISOString(), new Date().toISOString());
    db.prepare(
      `INSERT INTO agent_memory_candidates
         (id, tenant_id, capture_id, agent_id, memory_type, content, content_hash, status,
          belief_stage, metadata_json, created_at)
       VALUES (?, 'default-tenant', ?, 'codex', 'decision_intent', 'denied body b34', ?, 'rejected',
                  'silver_candidate_claim', ?, ?)`,
    ).run(
      candidateId,
      captureId,
      randomUUID().replace(/-/g, ""),
      JSON.stringify({ goalId, authorization: "denied" }),
      new Date().toISOString(),
    );
    const built = buildAgentContextPacket(db, { goalId, actorAgentId: "codex-cli-agent", lane: "safety" });
    const memory = built.packet.memories.find((m) => m.id === candidateId);
    expect(memory?.authorization).toBe("denied");
    expect(memory?.title).toBe("decision_intent");
    expect(memory?.whyIncluded).toContain("denied");
  });
});
