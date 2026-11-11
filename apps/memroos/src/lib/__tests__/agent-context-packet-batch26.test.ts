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

describe("agent-context-packet batch26 — status, artifacts, ontology denial, approvals", () => {
  it("statusFor maps completed delegations to complete goal status", () => {
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO hive_delegations
         (task_id, from_agent, to_agent, task_summary, status, created_at, updated_at)
       VALUES (?, 'director', 'worker', 'Done goal', 'completed', datetime('now'), datetime('now'))`,
    ).run(goalId);
    const built = buildAgentContextPacket(db, {
      goalId,
      actorAgentId: "codex-cli-agent",
      lane: "ops",
      goalTitle: "Completed batch26",
    });
    expect(built.packet.goal.status).toBe("complete");
  });

  it("artifactEntriesFromJson maps url objects and ledger approvals classify bypass events", () => {
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO agent_checkpoints
         (id, tenant_id, run_id, owner_agent_id, objective, completed_steps_json, remaining_steps_json,
          decisions_json, artifact_refs_json, verification_state_json, next_safe_action, rollback_notes,
          provenance_pointers_json, checkpoint_size, write_latency_ms, created_at)
       VALUES (?, 'default-tenant', ?, 'worker', 'Artifacts', '[]', '[]', '{}', ?, '{}', 'continue', NULL, '[]', 1, 1, datetime('now'))`,
    ).run(
      randomUUID(),
      goalId,
      JSON.stringify([{ url: "http://localhost/docs/b26", hash: "abc123" }]),
    );
    db.prepare(
      `INSERT INTO audit_entries
         (tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
       VALUES ('default-tenant', 'operator', 'operator', 'approval_bypassed', 'goal', ?, 'emergency', '{}', datetime('now'))`,
    ).run(goalId);
    const ledger = readAgentRunLedger(db, { goalId, lane: "code" });
    expect(ledger.artifacts.some((a) => a.kind === "url")).toBe(true);
    expect(ledger.approvals.some((a) => a.status === "bypassed")).toBe(true);
  });

  it("efficiency retrieval_trace with sources yields included receipt status", () => {
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, task_id, agent_id, event_type, payload, created_at)
       VALUES ('default-tenant', ?, 'codex', 'retrieval_trace', ?, datetime('now'))`,
    ).run(goalId, JSON.stringify({ sources: [{ id: "s1" }] }));
    const built = buildAgentContextPacket(db, {
      goalId,
      actorAgentId: "codex-cli-agent",
      lane: "memory",
      constraints: { requiredVerification: ["manual-review"] },
      userId: "user-b26",
      delegatedChain: ["director", "worker"],
    });
    expect(
      built.packet.receipts.some(
        (r) => r.status === "included" && r.reason.includes("source references"),
      ),
    ).toBe(true);
    expect(built.packet.constraints.requiredVerification).toContain("manual-review");
    expect(built.packet.actor.userId).toBe("user-b26");
    expect(built.packet.actor.delegatedChain).toEqual(["director", "worker"]);
  });

  it("ontologyReference injection denied when reference cannot be resolved", () => {
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
       VALUES (?, 'default-tenant', ?, 'codex', 'lesson', 'body', ?, 'candidate', 'silver_candidate_claim', ?, ?)`,
    ).run(
      candidateId,
      captureId,
      "c".repeat(64),
      JSON.stringify({
        goalId,
        ontologyReference: {
          tenantId: "default-tenant",
          spaceId: "missing-space-b26",
          recordType: "belief_candidate",
          recordId: candidateId,
        },
      }),
      new Date().toISOString(),
    );
    const built = buildAgentContextPacket(db, {
      goalId,
      actorAgentId: "codex-cli-agent",
      lane: "ops",
    });
    expect(built.packet.memories.find((m) => m.id === candidateId)?.authorization).toBe("denied");
    expect(
      built.packet.receipts.some(
        (r) => r.source === "ontology_validity" && r.status === "denied",
      ),
    ).toBe(true);
  });
});
