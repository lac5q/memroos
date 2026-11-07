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

describe("agent-context-packet batch30 — receipt and memory authorization branches", () => {
  it("adds skipped trace receipt when no trace rows exist", () => {
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    const built = buildAgentContextPacket(db, {
      goalId,
      actorAgentId: "codex-cli-agent",
      lane: "deployment",
    });
    expect(
      built.packet.receipts.some(
        (r) => r.source === "agent_memory_traces" && r.status === "skipped" && /no memory trace rows/i.test(r.reason ?? ""),
      ),
    ).toBe(true);
  });

  it("efficiency retrieval_trace below_threshold when sources array is empty", () => {
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, task_id, agent_id, event_type, payload, created_at)
       VALUES ('default-tenant', ?, 'codex', 'retrieval_trace', ?, datetime('now'))`,
    ).run(goalId, JSON.stringify({ sources: [] }));
    const built = buildAgentContextPacket(db, {
      goalId,
      actorAgentId: "codex-cli-agent",
      lane: "memory",
    });
    expect(
      built.packet.receipts.some((r) => r.status === "below_threshold" && /no source references/i.test(r.reason)),
    ).toBe(true);
  });

  it("memory entries hide provenance when authorization is denied", () => {
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
       VALUES (?, 'default-tenant', ?, 'codex', 'decision_intent', 'batch30 body', ?, 'candidate',
               'silver_candidate_claim', ?, ?)`,
    ).run(
      candidateId,
      captureId,
      randomUUID().replace(/-/g, ""),
      JSON.stringify({
        goalId,
        authorization: "denied",
        provenance: ["batch30-should-hide"],
      }),
      new Date().toISOString(),
    );
    const built = buildAgentContextPacket(db, {
      goalId,
      actorAgentId: "codex-cli-agent",
      lane: "gtm",
    });
    const memory = built.packet.memories.find((m) => m.id === candidateId);
    expect(memory?.authorization).toBe("denied");
    expect(memory?.provenance).not.toContain("batch30-should-hide");
    expect(memory?.whyIncluded).toMatch(/denied/i);
  });

  it("readAgentRunLedger classifies canceled delegation as blocked status source", () => {
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO hive_delegations
         (task_id, from_agent, to_agent, task_summary, status, created_at, updated_at)
       VALUES (?, 'director', 'worker', 'Canceled batch30', 'canceled', datetime('now'), datetime('now'))`,
    ).run(goalId);
    const built = buildAgentContextPacket(db, {
      goalId,
      actorAgentId: "codex-cli-agent",
      lane: "safety",
    });
    expect(built.packet.goal.status).toBe("blocked");
    const ledger = readAgentRunLedger(db, { goalId, lane: "safety" });
    expect(ledger.tasks[0]?.status).toBe("canceled");
  });
});
