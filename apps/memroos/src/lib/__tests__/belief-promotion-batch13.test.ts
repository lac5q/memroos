// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initSchema } from "../db-schema";
import {
  canAdmitToGold,
  promoteCandidate,
  resolveReview,
} from "../belief/promotion";
import { ensureCanonicalUpperOntology } from "../ontology/registry";
import { resolveOntologyValidity } from "../ontology/validity";

const TENANT = "default-tenant";

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  ensureCanonicalUpperOntology(db, "operator");
  db.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)`).run(TENANT, "Default");
  return db;
}

function insertMinimalCandidate(db: Database.Database): { candidateId: string; captureId: string } {
  const captureId = crypto.randomUUID();
  const artifactId = `artifact-${captureId}`;
  db.prepare(
    `INSERT OR IGNORE INTO raw_artifacts (id, tenant_id, source_type, artifact_uri, artifact_path, content_hash)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(artifactId, TENANT, "test_fixture", `memroos://test/${artifactId}`, `/tmp/${artifactId}`, artifactId);
  db.prepare(
    `INSERT INTO agent_session_captures
       (id, tenant_id, source_agent_id, runtime, project, repo_path, session_id, task_id,
        status, capture_health, model_route_json, summary, decision_intent_json,
        sources_json, files_json, commands_json, errors_json, verification_json,
        metadata_json, raw_artifact_id, capture_hash, captured_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'captured', 'ok', '{}', '', '{}',
             '[]', '[]', '[]', '[]', '[]', '{}', ?, ?, ?, ?)`
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
    crypto.randomUUID(),
    new Date().toISOString(),
    new Date().toISOString()
  );
  const candidateId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO agent_memory_candidates
       (id, tenant_id, capture_id, agent_id, memory_type, content, content_hash, status,
        belief_stage, metadata_json, created_at)
     VALUES (?, ?, ?, 'codex', 'decision_intent', ?, ?, 'candidate', 'silver_candidate_claim', ?, ?)`
  ).run(
    candidateId,
    TENANT,
    captureId,
    "batch13 content",
    crypto.createHash("sha256").update("batch13 content").digest("hex"),
    JSON.stringify({ visibility: "internal", policy: "agent_visible" }),
    new Date().toISOString()
  );
  const ontology = ensureCanonicalUpperOntology(db, "operator");
  const spaceId = "belief-review-space";
  const sourceId = `belief-source:${candidateId}`;
  const sourceHash = `sha256:${"d".repeat(64)}`;
  const derivativeId = `belief-record:${candidateId}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO ontology_versioned_records
      (id, tenant_id, space_id, record_type, record_id, qualified_type, ontology_id, ontology_version,
       ontology_content_hash, mapping_path_json, created_at, source_id, source_hash)
     VALUES (?, ?, ?, 'belief_candidate', ?, 'memory', ?, ?, ?, '[]', ?, ?, ?)`
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
    sourceHash
  );
  db.prepare(
    `INSERT INTO ontology_source_lifecycle
      (tenant_id, space_id, source_id, source_hash, status, updated_at, updated_by, reason_code)
     VALUES (?, ?, ?, ?, 'active', ?, 'operator', 'test')`
  ).run(TENANT, spaceId, sourceId, sourceHash, now);
  db.prepare(
    `INSERT INTO ontology_derivative_validity
      (id, tenant_id, space_id, source_id, source_hash, derivative_type, derivative_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'versioned_record', ?, 'authoritative', ?)`
  ).run(`valid:${derivativeId}`, TENANT, spaceId, sourceId, sourceHash, derivativeId, now);
  return { candidateId, captureId };
}

describe("belief promotion batch13", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    db.close();
  });

  it("canAdmitToGold admits operational candidates using pre-resolved ontology context", () => {
    const { candidateId } = insertMinimalCandidate(db);
    const ref = {
      tenantId: TENANT,
      spaceId: "belief-review-space",
      recordType: "belief_candidate" as const,
      recordId: candidateId,
    };
    const context = resolveOntologyValidity(db, ref);
    const admitted = canAdmitToGold(db, TENANT, candidateId, {
      actor: { id: "operator", role: "operator" },
      category: "operational",
      ontology: context,
    });
    expect(admitted.kind).toBe("admitted");
  });

  it("resolveReview approved path revalidates queued ontology and admits", () => {
    const { candidateId } = insertMinimalCandidate(db);
    const queued = promoteCandidate(db, {
      candidateId,
      tenantId: TENANT,
      actor: { id: "operator", role: "operator" },
      category: "pricing",
    });
    expect(queued.kind).toBe("queued_for_review");
    if (queued.kind !== "queued_for_review") throw new Error("expected queue");
    const resolved = resolveReview(db, {
      queueId: queued.queueId,
      tenantId: TENANT,
      resolution: "approved",
      operatorId: "operator-2",
      category: "pricing",
    });
    expect(resolved.admission.kind).toBe("admitted");
  });

  it("promoteCandidate queues unlisted sensitive labels for review", () => {
    const { candidateId } = insertMinimalCandidate(db);
    db.prepare(
      `UPDATE agent_memory_candidates SET metadata_json = ? WHERE id = ?`
    ).run(JSON.stringify({ visibility: "internal", policy: "agent_visible", sensitivity: "export_control" }), candidateId);
    const decision = promoteCandidate(db, {
      candidateId,
      tenantId: TENANT,
      actor: { id: "operator", role: "operator" },
      category: "operational",
    });
    expect(decision.kind).toBe("queued_for_review");
    if (decision.kind === "queued_for_review") {
      expect(decision.reason).toBe("unlisted_sensitive_label");
    }
  });

  it("canAdmitToGold throws ontology_context_invalidated when review ontology resolution throws", () => {
    const { candidateId } = insertMinimalCandidate(db);
    const queued = promoteCandidate(db, {
      candidateId,
      tenantId: TENANT,
      actor: { id: "operator", role: "operator" },
      category: "pricing",
    });
    expect(queued.kind).toBe("queued_for_review");
    if (queued.kind !== "queued_for_review") throw new Error("expected queue");
    db.prepare(`DELETE FROM ontology_versioned_records WHERE record_id = ?`).run(candidateId);
    expect(() =>
      canAdmitToGold(db, TENANT, candidateId, {
        actor: { id: "operator-2", role: "operator" },
        category: "pricing",
        reviewedQueueId: queued.queueId,
      })
    ).toThrow(/ontology_context_invalidated/);
  });
});
