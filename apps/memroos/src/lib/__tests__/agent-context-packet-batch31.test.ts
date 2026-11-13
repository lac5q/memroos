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

describe("agent-context-packet batch31 — audit, trace, actor, and artifact branches", () => {
  it("classifies bypassed audit approvals and denied trace policy filters", () => {
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO audit_entries
         (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, created_at)
       VALUES (?, 'default-tenant', 'op', 'operator', 'skillforge.bypass', 'proposal', ?, 'batch31 bypass', datetime('now'))`,
    ).run(`audit-${randomUUID().slice(0, 8)}`, goalId);
    const traceId = randomUUID();
    db.prepare(
      `INSERT INTO agent_memory_traces
         (id, tenant_id, run_id, task_id, agent_id, causal_path_json, created_at)
       VALUES (?, 'default-tenant', ?, ?, 'codex', ?, datetime('now'))`,
    ).run(
      traceId,
      goalId,
      goalId,
      JSON.stringify({ policyFilters: [{ decision: "deny", reason: "batch31 policy deny" }] }),
    );
    const built = buildAgentContextPacket(db, { goalId, actorAgentId: "codex-cli-agent", lane: "safety" });
    expect(built.packet.receipts.some((r) => r.status === "denied" && /batch31 policy deny/.test(r.reason ?? ""))).toBe(
      true,
    );
    const ledger = readAgentRunLedger(db, { goalId, lane: "safety" });
    expect(ledger.approvals.some((a) => a.status === "bypassed")).toBe(true);
  });

  it("records non-retrieval efficiency events and checkpoint artifact url kinds", () => {
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    const checkpointId = randomUUID();
    db.prepare(
      `INSERT INTO agent_checkpoints
         (id, tenant_id, run_id, owner_agent_id, objective, artifact_refs_json, decisions_json, verification_state_json, next_safe_action, created_at)
       VALUES (?, 'default-tenant', ?, 'codex', 'batch31 checkpoint', ?, '{}', '{}', 'resume', datetime('now'))`,
    ).run(
      checkpointId,
      goalId,
      JSON.stringify([{ id: "artifact-url-b31", url: "https://example.com/proof", kind: "url" }]),
    );
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, task_id, agent_id, event_type, payload, created_at)
       VALUES ('default-tenant', ?, 'codex', 'token_ledger', ?, datetime('now'))`,
    ).run(goalId, JSON.stringify({ modelId: "gpt-batch31", totalTokens: 1200 }));
    const built = buildAgentContextPacket(db, { goalId, actorAgentId: "codex-cli-agent", lane: "ops" });
    expect(
      built.packet.receipts.some((r) => r.source === "efficiency_events" && /token_ledger/.test(r.reason)),
    ).toBe(true);
    expect(built.ledger.artifacts.some((a) => a.kind === "url")).toBe(true);
    expect(built.ledger.costs[0]?.model).toBe("gpt-batch31");
  });

  it("includes optional actor chain, handoff marker, and memory caveat", () => {
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
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
       VALUES (?, 'default-tenant', ?, 'codex', 'decision_intent', 'batch31 caveat body', ?, 'candidate',
               'silver_candidate_claim', ?, ?)`,
    ).run(
      candidateId,
      captureId,
      randomUUID().replace(/-/g, ""),
      JSON.stringify({ goalId, caveat: "batch31 caveat", whyIncluded: "matched goal" }),
      new Date().toISOString(),
    );
    db.prepare(
      `INSERT INTO agent_handoff_packs
         (id, tenant_id, task_id, title, context_pack_json, created_at)
       VALUES (?, 'default-tenant', ?, 'handoff-b31', ?, datetime('now'))`,
    ).run(randomUUID(), goalId, JSON.stringify({ resumeMarker: "resume-batch31", next_action: "shipcheck" }));
    const built = buildAgentContextPacket(db, {
      goalId,
      actorAgentId: "codex-cli-agent",
      userId: "user-batch31",
      delegatedChain: ["director", "codex-cli-agent"],
      lane: "gtm",
    });
    expect(built.packet.actor.userId).toBe("user-batch31");
    expect(built.packet.actor.delegatedChain).toEqual(["director", "codex-cli-agent"]);
    expect(built.packet.recentRunState.handoff).toBe("resume-batch31");
    const memory = built.packet.memories.find((m) => m.id === candidateId);
    expect(memory?.caveat).toBe("batch31 caveat");
  });
});
