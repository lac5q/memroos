// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { ensureCanonicalUpperOntology } from "@/lib/ontology/registry";
import { canAdmitToGold, promoteCandidate } from "../promotion";

const TENANT = "default-tenant";

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  ensureCanonicalUpperOntology(db, "operator");
  db.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)`).run(TENANT, "Default");
  return db;
}

function insertCandidate(
  db: Database.Database,
  opts: { metadataJson?: string; memoryType?: string } = {},
): string {
  const captureId = randomUUID();
  const artifactId = `artifact-${captureId}`;
  db.prepare(
    `INSERT OR IGNORE INTO raw_artifacts (id, tenant_id, source_type, artifact_uri, artifact_path, content_hash)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(artifactId, TENANT, "test_fixture", `memroos://test/${artifactId}`, `/tmp/${artifactId}`, artifactId);
  db.prepare(
    `INSERT INTO agent_session_captures
       (id, tenant_id, source_agent_id, runtime, project, repo_path, session_id, task_id,
        status, capture_health, model_route_json, summary, decision_intent_json,
        sources_json, files_json, commands_json, errors_json, verification_json,
        metadata_json, raw_artifact_id, capture_hash, captured_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'captured', 'ok', '{}', '', '{}',
             '[]', '[]', '[]', '[]', '[]', '{}', ?, ?, ?, ?)`,
  ).run(
    captureId,
    TENANT,
    "codex",
    "test",
    "memroos",
    "/repo",
    "session-1",
    "task-1",
    artifactId,
    randomUUID(),
    new Date().toISOString(),
    new Date().toISOString(),
  );
  const candidateId = randomUUID();
  db.prepare(
    `INSERT INTO agent_memory_candidates
       (id, tenant_id, capture_id, agent_id, memory_type, content, content_hash, status,
        belief_stage, metadata_json, created_at)
     VALUES (?, ?, ?, 'codex', ?, ?, ?, 'candidate', 'silver_candidate_claim', ?, ?)`,
  ).run(
    candidateId,
    TENANT,
    captureId,
    opts.memoryType ?? "decision_intent",
    "batch22 promotion body",
    "d".repeat(64),
    opts.metadataJson ?? JSON.stringify({ visibility: "public", policy: "agent_visible" }),
    new Date().toISOString(),
  );
  const ontology = ensureCanonicalUpperOntology(db, "operator");
  const spaceId = "belief-review-space";
  const sourceId = `belief-source:${candidateId}`;
  const sourceHash = `sha256:${"b".repeat(64)}`;
  const derivativeId = `belief-record:${candidateId}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO ontology_versioned_records
      (id, tenant_id, space_id, record_type, record_id, qualified_type, ontology_id, ontology_version,
       ontology_content_hash, mapping_path_json, created_at, source_id, source_hash)
     VALUES (?, ?, ?, 'belief_candidate', ?, 'memory', ?, ?, ?, '[]', ?, ?, ?)`,
  ).run(
    derivativeId,
    TENANT,
    spaceId,
    candidateId,
    ontology.ontologyId,
    ontology.version,
    ontology.contentHash,
    now,
    sourceId,
    sourceHash,
  );
  db.prepare(
    `INSERT INTO ontology_source_lifecycle
      (tenant_id, space_id, source_id, source_hash, status, updated_at, updated_by, reason_code)
     VALUES (?, ?, ?, ?, 'active', ?, 'operator', 'test')`,
  ).run(TENANT, spaceId, sourceId, sourceHash, now);
  db.prepare(
    `INSERT INTO ontology_derivative_validity
      (id, tenant_id, space_id, source_id, source_hash, derivative_type, derivative_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'versioned_record', ?, 'authoritative', ?)`,
  ).run(`valid:${derivativeId}`, TENANT, spaceId, sourceId, sourceHash, derivativeId, now);
  return candidateId;
}

describe("belief promotion batch22 — unlisted sensitive and queue ontology guards", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  it("queues non-high-stakes categories when metadata carries an unlisted sensitive label", () => {
    const candidateId = insertCandidate(db);
    db.prepare(`UPDATE agent_memory_candidates SET metadata_json = ? WHERE id = ?`).run(
      JSON.stringify({ visibility: "internal", policy: "agent_visible", sensitivity: "Restricted" }),
      candidateId,
    );
    const decision = promoteCandidate(db, {
      candidateId,
      tenantId: TENANT,
      actor: { id: "operator", role: "operator" },
      category: "engineering",
    });
    expect(decision.kind).toBe("queued_for_review");
    if (decision.kind === "queued_for_review") {
      expect(decision.reason).toBe("unlisted_sensitive_label");
    }
  });

  it("canAdmitToGold rejects approved queue rows with incomplete ontology coordinates", () => {
    const candidateId = insertCandidate(db);
    const queueId = randomUUID();
    db.prepare(
      `INSERT INTO belief_review_queue
         (id, tenant_id, candidate_id, category, status, opened_by, opened_at)
       VALUES (?, ?, ?, 'pricing', 'approved', 'operator', datetime('now'))`,
    ).run(queueId, TENANT, candidateId);
    expect(() =>
      canAdmitToGold(db, TENANT, candidateId, {
        actor: { id: "operator", role: "operator" },
        category: "pricing",
        reviewedQueueId: queueId,
      }),
    ).toThrow(/ontology_context_invalidated/);
  });

  it("canAdmitToGold throws ontology_context_unavailable when high-stakes review lacks ontology records", () => {
    const candidateId = insertCandidate(db);
    db.prepare(`DELETE FROM ontology_versioned_records WHERE record_id = ?`).run(candidateId);
    expect(() =>
      canAdmitToGold(db, TENANT, candidateId, {
        actor: { id: "operator", role: "operator" },
        category: "pricing",
      }),
    ).toThrow(/ontology_context_unavailable/);
  });
});
