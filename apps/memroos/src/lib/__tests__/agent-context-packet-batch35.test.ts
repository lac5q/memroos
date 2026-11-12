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

describe("agent-context-packet batch35 — ledger, trace, decisions, ontology branches", () => {
  it("decisionsFrom preserves string decision values (281)", () => {
    const goalId = `goal-dec-b35-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO agent_checkpoints
         (id, tenant_id, run_id, owner_agent_id, objective, artifact_refs_json, decisions_json, verification_state_json, next_safe_action, created_at)
       VALUES (?, 'default-tenant', ?, 'codex', 'batch35', '[]', ?, '{}', 'resume', datetime('now'))`,
    ).run(randomUUID(), goalId, JSON.stringify({ ship: "proceed with batch35 string decision" }));
    const built = buildAgentContextPacket(db, { goalId, actorAgentId: "codex-cli-agent", lane: "ops" });
    expect(built.packet.decisions[0]?.summary).toBe("proceed with batch35 string decision");
  });

  it("artifactEntriesFromJson handles single object refs (287)", () => {
    const goalId = `goal-art-b35-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO agent_checkpoints
         (id, tenant_id, run_id, owner_agent_id, objective, artifact_refs_json, decisions_json, verification_state_json, next_safe_action, created_at)
       VALUES (?, 'default-tenant', ?, 'codex', 'artifact object', ?, '{}', '{}', 'resume', datetime('now'))`,
    ).run(randomUUID(), goalId, JSON.stringify({ path: "/tmp/proof-b35.txt", hash: "abc-b35" }));
    const ledger = readAgentRunLedger(db, { goalId, lane: "code" });
    expect(ledger.artifacts.some((a) => a.kind === "artifact" && a.hash === "abc-b35")).toBe(true);
  });

  it("trace receipts include policy filters and retrieval sources (313, 330-332)", () => {
    const goalId = `goal-trace-b35-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO agent_memory_traces
         (id, tenant_id, run_id, task_id, agent_id, causal_path_json, created_at)
       VALUES (?, 'default-tenant', ?, ?, 'codex', ?, datetime('now'))`,
    ).run(
      randomUUID(),
      goalId,
      goalId,
      JSON.stringify({ policyFilters: [{ decision: "allow", reason: "batch35 allow" }] }),
    );
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, task_id, agent_id, event_type, payload, created_at)
       VALUES ('default-tenant', ?, 'codex', 'retrieval_trace', ?, datetime('now'))`,
    ).run(goalId, JSON.stringify({ sources: ["vector-b35", "lexical-b35"] }));
    const built = buildAgentContextPacket(db, { goalId, actorAgentId: "codex-cli-agent", lane: "ops" });
    expect(built.packet.receipts.some((r) => r.status === "included" && /batch35 allow/.test(r.reason ?? ""))).toBe(true);
    expect(
      built.packet.receipts.some((r) => r.source === "efficiency_events" && /2 source references/.test(r.reason ?? "")),
    ).toBe(true);
  });

  it("ledger maps approvals, costs, and checkpoint events (433-483)", () => {
    const goalId = `goal-ledger-b35-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO hive_delegations (task_id, from_agent, to_agent, task_summary, status, created_at, updated_at)
       VALUES (?, 'director', 'codex', 'batch35 delegation', 'active', datetime('now'), datetime('now'))`,
    ).run(goalId);
    db.prepare(
      `INSERT INTO hive_actions (agent_id, action_type, summary, artifacts, timestamp)
       VALUES ('codex', 'checkpoint', 'hive batch35', ?, datetime('now'))`,
    ).run(JSON.stringify({ task_id: goalId }));
    db.prepare(
      `INSERT INTO agent_checkpoints
         (id, tenant_id, run_id, owner_agent_id, objective, artifact_refs_json, decisions_json, verification_state_json, next_safe_action, created_at)
       VALUES (?, 'default-tenant', ?, 'codex', 'ledger checkpoint', '[]', '{}', ?, 'resume', datetime('now'))`,
    ).run(randomUUID(), goalId, JSON.stringify({ shipcheck: "passed" }));
    db.prepare(
      `INSERT INTO audit_entries
         (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, created_at)
       VALUES ('default-tenant', 'op', 'operator', 'skillforge.approved', 'proposal', ?, 'approved batch35', datetime('now'))`,
    ).run(goalId);
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, task_id, agent_id, event_type, payload, created_at)
       VALUES ('default-tenant', ?, 'codex', 'token_ledger', ?, datetime('now'))`,
    ).run(goalId, JSON.stringify({ modelId: "haiku-b35" }));
    const ledger = readAgentRunLedger(db, { goalId, lane: "ops" });
    expect(ledger.tasks[0]?.owner).toBe("codex");
    expect(ledger.approvals.some((a) => a.status === "approved")).toBe(true);
    expect(ledger.costs[0]?.model).toBe("haiku-b35");
    expect(ledger.verifications.some((v) => v.requiredProof === "shipcheck")).toBe(true);
  });

  it("ontology injection denial uses memory type title fallback (657-658)", () => {
    const goalId = `goal-onto-b35-${randomUUID().slice(0, 8)}`;
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
       VALUES (?, 'default-tenant', ?, 'codex', 'lesson', 'ontology fail batch35', ?, 'candidate',
                  'silver_candidate_claim', ?, ?)`,
    ).run(
      candidateId,
      captureId,
      randomUUID().replace(/-/g, ""),
      JSON.stringify({ goalId, ontologyReference: { bogus: true } }),
      new Date().toISOString(),
    );
    const built = buildAgentContextPacket(db, { goalId, actorAgentId: "codex-cli-agent", lane: "safety" });
    const memory = built.packet.memories.find((m) => m.id === candidateId);
    expect(memory?.authorization).toBe("denied");
    expect(memory?.title).toBe("lesson");
  });
});
