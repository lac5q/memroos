// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { ensureCanonicalUpperOntology } from "@/lib/ontology/registry";
import { buildAgentContextPacket, readAgentRunLedger } from "../agent-context-packet";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  ensureCanonicalUpperOntology(db, "operator");
  return db;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("agent-context-packet batch17 — parsing, status, ontology inclusion", () => {
  it("buildAgentContextPacket marks failed delegations as blocked goals", () => {
    const database = freshDb();
    const goalId = `goal-fail-${crypto.randomUUID().slice(0, 8)}`;
    database
      .prepare(
        `INSERT INTO hive_delegations
         (task_id, from_agent, to_agent, task_summary, status, created_at, updated_at)
         VALUES (?, 'agent-a', 'agent-b', 'Failed task', 'failed', ?, ?)`,
      )
      .run(goalId, "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
    const { packet } = buildAgentContextPacket(database, {
      goalId,
      actorAgentId: "agent-a",
      lane: "ops",
      now: () => new Date("2026-07-01T00:01:00.000Z"),
    });
    expect(packet.goal.status).toBe("blocked");
  });

  it("buildAgentContextPacket treats malformed metadata_json as empty metadata", () => {
    const database = freshDb();
    const goalId = `goal-meta-${crypto.randomUUID().slice(0, 8)}`;
    const candidateId = crypto.randomUUID();
    const captureId = crypto.randomUUID();
    database
      .prepare(
        `INSERT INTO agent_session_captures
         (id, tenant_id, source_agent_id, runtime, session_id, capture_hash, captured_at)
         VALUES (?, 'default-tenant', 'agent-1', 'test', 'session-1', ?, ?)`,
      )
      .run(captureId, crypto.randomUUID(), "2026-07-01T00:00:00.000Z");
    database
      .prepare(
        `INSERT INTO agent_memory_candidates
         (id, tenant_id, capture_id, agent_id, memory_type, content, content_hash, status,
          belief_stage, metadata_json, created_at)
         VALUES (?, 'default-tenant', ?, 'agent-1', 'decision_intent', 'content', ?, 'candidate',
          'bronze_raw_source', ?, ?)`,
      )
      .run(
        candidateId,
        captureId,
        "a".repeat(64),
        JSON.stringify({ goalId, ontologyReference: {} }),
        "2026-07-01T00:00:00.000Z",
      );

    const { packet } = buildAgentContextPacket(database, {
      goalId,
      actorAgentId: "agent-1",
      lane: "memory",
    });
    const memory = packet.memories.find((m) => m.id === candidateId);
    expect(memory?.beliefStage).toBe("bronze_raw_source");
    expect(packet.receipts.some((r) => r.reason === "ontology_context_unavailable")).toBe(true);
  });

  it("buildAgentContextPacket resolves valid ontology references into included receipts", () => {
    const database = freshDb();
    const goalId = `goal-ont-ok-${crypto.randomUUID().slice(0, 8)}`;
    const candidateId = crypto.randomUUID();
    const captureId = crypto.randomUUID();
    const spaceId = "belief-review-space";
    database
      .prepare(
        `INSERT INTO agent_session_captures
         (id, tenant_id, source_agent_id, runtime, session_id, capture_hash, captured_at)
         VALUES (?, 'default-tenant', 'agent-1', 'test', 'session-1', ?, ?)`,
      )
      .run(captureId, crypto.randomUUID(), "2026-07-01T00:00:00.000Z");
    const ontology = ensureCanonicalUpperOntology(database, "operator");
    const sourceId = `belief-source:${candidateId}`;
    const sourceHash = `sha256:${"f".repeat(64)}`;
    const derivativeId = `belief-record:${candidateId}`;
    const now = "2026-07-01T00:00:00.000Z";
    database
      .prepare(
        `INSERT INTO ontology_versioned_records
          (id, tenant_id, space_id, record_type, record_id, qualified_type, ontology_id, ontology_version,
           ontology_content_hash, mapping_path_json, created_at, source_id, source_hash)
         VALUES (?, 'default-tenant', ?, 'belief_candidate', ?, 'memory', ?, ?, ?, '[]', ?, ?, ?)`,
      )
      .run(
        derivativeId,
        spaceId,
        candidateId,
        ontology.ontologyId,
        ontology.version,
        ontology.contentHash,
        now,
        sourceId,
        sourceHash,
      );
    database
      .prepare(
        `INSERT INTO ontology_source_lifecycle
          (tenant_id, space_id, source_id, source_hash, status, updated_at, updated_by, reason_code)
         VALUES ('default-tenant', ?, ?, ?, 'active', ?, 'operator', 'test')`,
      )
      .run(spaceId, sourceId, sourceHash, now);
    database
      .prepare(
        `INSERT INTO ontology_derivative_validity
          (id, tenant_id, space_id, source_id, source_hash, derivative_type, derivative_id, status, created_at)
         VALUES (?, 'default-tenant', ?, ?, ?, 'versioned_record', ?, 'authoritative', ?)`,
      )
      .run(`valid:${derivativeId}`, spaceId, sourceId, sourceHash, derivativeId, now);
    database
      .prepare(
        `INSERT INTO agent_memory_candidates
         (id, tenant_id, capture_id, agent_id, memory_type, content, content_hash, status,
          belief_stage, metadata_json, created_at)
         VALUES (?, 'default-tenant', ?, 'agent-1', 'decision_intent', 'content', ?, 'candidate',
          'silver_candidate_claim', ?, ?)`,
      )
      .run(
        candidateId,
        captureId,
        "a".repeat(64),
        JSON.stringify({
          goalId,
          ontologyReference: {
            tenantId: "default-tenant",
            spaceId,
            recordType: "belief_candidate",
            recordId: candidateId,
          },
        }),
        "2026-07-01T00:00:00.000Z",
      );

    const { packet } = buildAgentContextPacket(database, {
      goalId,
      actorAgentId: "agent-1",
      lane: "memory",
    });
    expect(packet.receipts.some((r) => r.reason === "server_resolved_ontology_context")).toBe(true);
    const memory = packet.memories.find((m) => m.id === candidateId);
    expect(memory?.authorization).toBe("allowed");
  });

  it("readAgentRunLedger tolerates prepare failures via maybeGet guard", () => {
    const database = freshDb();
    const goalId = `goal-guard-${crypto.randomUUID().slice(0, 8)}`;
    const originalPrepare = database.prepare.bind(database);
    database.prepare = ((sql: string) => {
      if (sql.includes("agent_checkpoints")) {
        throw new Error("simulated checkpoint query failure");
      }
      return originalPrepare(sql);
    }) as typeof database.prepare;
    const ledger = readAgentRunLedger(database, { goalId, lane: "ops" });
    expect(ledger.goalId).toBe(goalId);
  });
});
