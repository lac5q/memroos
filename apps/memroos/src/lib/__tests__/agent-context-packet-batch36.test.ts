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

describe("agent-context-packet batch36 — status, trace allow, redacted, ledger", () => {
  it("statusFor maps completed delegation to complete (262)", () => {
    const goalId = `goal-done-b36-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO hive_delegations (task_id, from_agent, to_agent, task_summary, status, created_at, updated_at)
       VALUES (?, 'director', 'codex', 'done b36', 'completed', datetime('now'), datetime('now'))`,
    ).run(goalId);
    const built = buildAgentContextPacket(db, { goalId, actorAgentId: "codex-cli-agent" });
    expect(built.packet.goal.status).toBe("complete");
  });

  it("statusFor maps paused delegation to active (264)", () => {
    const goalId = `goal-pause-b36-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO hive_delegations (task_id, from_agent, to_agent, task_summary, status, created_at, updated_at)
       VALUES (?, 'director', 'codex', 'pause b36', 'paused', datetime('now'), datetime('now'))`,
    ).run(goalId);
    const built = buildAgentContextPacket(db, { goalId, actorAgentId: "codex-cli-agent" });
    expect(built.packet.goal.status).toBe("active");
  });

  it("statusFor maps canceled delegation to blocked (263)", () => {
    const goalId = `goal-cancel-b36-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO hive_delegations (task_id, from_agent, to_agent, task_summary, status, created_at, updated_at)
       VALUES (?, 'director', 'codex', 'cancel b36', 'canceled', datetime('now'), datetime('now'))`,
    ).run(goalId);
    const built = buildAgentContextPacket(db, { goalId, actorAgentId: "codex-cli-agent" });
    expect(built.packet.goal.status).toBe("blocked");
  });

  it("traceReceipts marks non-deny filters as included (312)", () => {
    const goalId = `goal-allow-b36-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO agent_memory_traces
         (id, tenant_id, run_id, task_id, agent_id, causal_path_json, created_at)
       VALUES (?, 'default-tenant', ?, ?, 'codex', ?, datetime('now'))`,
    ).run(
      randomUUID(),
      goalId,
      goalId,
      JSON.stringify({ policyFilters: [{ decision: "allow", reason: "batch36 allow arm" }] }),
    );
    const built = buildAgentContextPacket(db, { goalId, actorAgentId: "codex-cli-agent" });
    expect(built.packet.receipts.some((r) => r.status === "included" && /batch36 allow/i.test(r.reason ?? ""))).toBe(
      true,
    );
  });

  it("efficiencyReceipts includes non-retrieval_trace events (340-345)", () => {
    const goalId = `goal-eff-b36-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, task_id, agent_id, event_type, payload, created_at)
       VALUES ('default-tenant', ?, 'codex', 'operator_question', ?, datetime('now'))`,
    ).run(goalId, JSON.stringify({ question: "batch36 operator probe" }));
    const built = buildAgentContextPacket(db, { goalId, actorAgentId: "codex-cli-agent" });
    expect(
      built.packet.receipts.some(
        (r) => r.source === "efficiency_events" && r.status === "included" && /operator_question/i.test(r.reason ?? ""),
      ),
    ).toBe(true);
  });

  it("authorizationFor redacted metadata surfaces redacted memories (223-225, 670)", () => {
    const goalId = `goal-redact-b36-${randomUUID().slice(0, 8)}`;
    const captureId = randomUUID();
    const candidateId = randomUUID();
    db.prepare(
      `INSERT OR IGNORE INTO raw_artifacts (id, tenant_id, source_type, artifact_uri, artifact_path, content_hash)
       VALUES (?, 'default-tenant', 'test_fixture', ?, ?, ?)`,
    ).run(`art-b36-${candidateId}`, `memroos://test/${candidateId}`, `/tmp/${candidateId}`, candidateId);
    db.prepare(
      `INSERT INTO agent_session_captures
         (id, tenant_id, source_agent_id, runtime, project, repo_path, session_id, task_id,
          status, capture_health, model_route_json, summary, decision_intent_json,
          sources_json, files_json, commands_json, errors_json, verification_json,
          metadata_json, raw_artifact_id, capture_hash, captured_at, updated_at)
       VALUES (?, 'default-tenant', 'codex', 'test', 'memroos', '/repo', 's', 't',
               'captured', 'ok', '{}', '', '{}', '[]', '[]', '[]', '[]', '[]', '{}', ?, ?, ?, ?)`,
    ).run(captureId, `art-b36-${candidateId}`, randomUUID(), new Date().toISOString(), new Date().toISOString());
    db.prepare(
      `INSERT INTO agent_memory_candidates
         (id, tenant_id, capture_id, agent_id, memory_type, content, content_hash, status,
          belief_stage, metadata_json, created_at)
       VALUES (?, 'default-tenant', ?, 'codex', 'lesson', 'redacted body b36', ?, 'candidate',
                  'silver_candidate_claim', ?, ?)`,
    ).run(
      candidateId,
      captureId,
      randomUUID().replace(/-/g, ""),
      JSON.stringify({ goalId, authorization: "redacted", title: "Sensitive batch36" }),
      new Date().toISOString(),
    );
    const built = buildAgentContextPacket(db, { goalId, actorAgentId: "codex-cli-agent" });
    const memory = built.packet.memories.find((m) => m.id === candidateId);
    expect(memory?.authorization).toBe("redacted");
    expect(memory?.title).toBe("Sensitive batch36");
  });

  it("readAgentRunLedger maps denied audit events (460-466)", () => {
    const goalId = `goal-deny-audit-b36-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO audit_entries
         (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, created_at)
       VALUES ('default-tenant', 'op', 'operator', 'skillforge.denied', 'proposal', ?, 'denied batch36', datetime('now'))`,
    ).run(goalId);
    const ledger = readAgentRunLedger(db, { goalId });
    expect(ledger.approvals.some((a) => a.status === "denied")).toBe(true);
  });

  it("beliefStageFor promotes status maps to gold (218)", () => {
    const goalId = `goal-gold-b36-${randomUUID().slice(0, 8)}`;
    const captureId = randomUUID();
    const candidateId = randomUUID();
    db.prepare(
      `INSERT OR IGNORE INTO raw_artifacts (id, tenant_id, source_type, artifact_uri, artifact_path, content_hash)
       VALUES (?, 'default-tenant', 'test_fixture', ?, ?, ?)`,
    ).run(`art-gold-b36`, `memroos://test/gold`, `/tmp/gold`, randomUUID());
    db.prepare(
      `INSERT INTO agent_session_captures
         (id, tenant_id, source_agent_id, runtime, project, repo_path, session_id, task_id,
          status, capture_health, model_route_json, summary, decision_intent_json,
          sources_json, files_json, commands_json, errors_json, verification_json,
          metadata_json, raw_artifact_id, capture_hash, captured_at, updated_at)
       VALUES (?, 'default-tenant', 'codex', 'test', 'memroos', '/repo', 's', ?,
               'captured', 'ok', '{}', '', '{}', '[]', '[]', '[]', '[]', '[]', '{}', 'art-gold-b36', ?, ?, ?)`,
    ).run(captureId, goalId, randomUUID(), new Date().toISOString(), new Date().toISOString());
    db.prepare(
      `INSERT INTO agent_memory_candidates
         (id, tenant_id, capture_id, agent_id, memory_type, content, content_hash, status,
          belief_stage, metadata_json, created_at)
       VALUES (?, 'default-tenant', ?, 'codex', 'task_state', 'gold b36', ?, 'promoted',
                  '', ?, ?)`,
    ).run(candidateId, captureId, randomUUID().replace(/-/g, ""), JSON.stringify({ goalId }), new Date().toISOString());
    const built = buildAgentContextPacket(db, { goalId, actorAgentId: "codex-cli-agent" });
    expect(built.packet.memories.find((m) => m.id === candidateId)?.beliefStage).toBe("gold_operational_truth");
  });
});
