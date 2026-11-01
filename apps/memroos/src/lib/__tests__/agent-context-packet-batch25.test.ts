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

describe("agent-context-packet batch25 — authz, trace receipts, ledger fallbacks", () => {
  it("honors authz redacted metadata and rejected candidate status", () => {
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

    const redactedId = randomUUID();
    db.prepare(
      `INSERT INTO agent_memory_candidates
         (id, tenant_id, capture_id, agent_id, memory_type, content, content_hash, status,
          belief_stage, metadata_json, created_at)
       VALUES (?, 'default-tenant', ?, 'codex', 'lesson', 'body', ?, 'candidate', 'silver_candidate_claim', ?, ?)`,
    ).run(
      redactedId,
      captureId,
      "a".repeat(64),
      JSON.stringify({ goalId, authz: "redacted", title: "Redacted lesson" }),
      new Date().toISOString(),
    );

    const rejectedId = randomUUID();
    db.prepare(
      `INSERT INTO agent_memory_candidates
         (id, tenant_id, capture_id, agent_id, memory_type, content, content_hash, status,
          belief_stage, metadata_json, created_at)
       VALUES (?, 'default-tenant', ?, 'codex', 'lesson', 'body2', ?, 'rejected', 'silver_candidate_claim', ?, ?)`,
    ).run(
      rejectedId,
      captureId,
      "b".repeat(64),
      JSON.stringify({ goalId, title: "Rejected lesson" }),
      new Date().toISOString(),
    );

    const built = buildAgentContextPacket(db, {
      goalId,
      actorAgentId: "codex-cli-agent",
      lane: "memory",
      goalTitle: "Authz batch25",
    });
    expect(built.packet.memories.find((m) => m.id === redactedId)?.authorization).toBe("redacted");
    expect(built.packet.memories.find((m) => m.id === rejectedId)?.authorization).toBe("denied");
  });

  it("maps trace policy filters and retrieval efficiency receipts", () => {
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    const traceId = randomUUID();
    db.prepare(
      `INSERT INTO agent_memory_traces
         (id, tenant_id, run_id, task_id, causal_path_json, created_at)
       VALUES (?, 'default-tenant', ?, ?, ?, datetime('now'))`,
    ).run(
      traceId,
      goalId,
      goalId,
      JSON.stringify({
        policyFilters: [
          { decision: "deny", reason: "pii blocked" },
          { decision: "allow", reason: "ok" },
        ],
      }),
    );
    db.prepare(
      `INSERT INTO agent_memory_traces
         (id, tenant_id, run_id, task_id, causal_path_json, created_at)
       VALUES (?, 'default-tenant', ?, ?, '{}', datetime('now'))`,
    ).run(randomUUID(), goalId, goalId);

    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, task_id, agent_id, event_type, payload, created_at)
       VALUES ('default-tenant', ?, 'codex', 'retrieval_trace', ?, datetime('now'))`,
    ).run(goalId, JSON.stringify({ sources: [] }));

    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, task_id, agent_id, event_type, payload, created_at)
       VALUES ('default-tenant', ?, 'codex', 'token_ledger', ?, datetime('now'))`,
    ).run(goalId, JSON.stringify({ modelId: "gpt-test", totalTokens: 42 }));

    const built = buildAgentContextPacket(db, {
      goalId,
      actorAgentId: "codex-cli-agent",
      lane: "ops",
      goalTitle: "Receipts batch25",
    });
    expect(built.packet.receipts.some((r) => r.status === "denied" && r.reason === "pii blocked")).toBe(true);
    expect(
      built.packet.receipts.some((r) => r.status === "skipped" && r.reason.includes("no policy filter")),
    ).toBe(true);
    expect(
      built.packet.receipts.some((r) => r.status === "below_threshold" && r.source === "efficiency_events"),
    ).toBe(true);
    expect(built.ledger.costs.some((c) => c.model === "gpt-test")).toBe(true);
  });

  it("readAgentRunLedger uses from_agent owner and string artifact entries", () => {
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO hive_delegations
         (task_id, from_agent, to_agent, task_summary, status, created_at, updated_at)
       VALUES (?, 'director-only', 'worker', 'Owner fallback', 'active', datetime('now'), datetime('now'))`,
    ).run(goalId);
    db.prepare(
      `INSERT INTO agent_checkpoints
         (id, tenant_id, run_id, owner_agent_id, objective, completed_steps_json, remaining_steps_json,
          decisions_json, artifact_refs_json, verification_state_json, next_safe_action, rollback_notes,
          provenance_pointers_json, checkpoint_size, write_latency_ms, created_at)
       VALUES (?, 'default-tenant', ?, 'worker', 'Checkpoint', '[]', '[]', ?, ?, '{}', 'continue', NULL, '[]', 1, 1, datetime('now'))`,
    ).run(
      randomUUID(),
      goalId,
      JSON.stringify({ d1: { nested: true }, d2: "plain decision" }),
      JSON.stringify(["/tmp/artifact-path", { path: "/tmp/obj", hash: "abc" }]),
    );

    const ledger = readAgentRunLedger(db, { goalId, lane: "code" });
    expect(ledger.tasks[0]?.owner).toBe("worker");
    expect(ledger.artifacts.some((a) => a.id === "/tmp/artifact-path")).toBe(true);
    expect(ledger.events.some((e) => e.actionType === "checkpoint")).toBe(true);

    const built = buildAgentContextPacket(db, {
      goalId,
      actorAgentId: "codex-cli-agent",
      lane: "code",
      goalTitle: "Ledger batch25",
    });
    expect(built.packet.decisions.some((d) => d.id === "d2")).toBe(true);
  });
});
