// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { canAdmitToGold, promoteCandidate } from "../promotion";
import { ensureCanonicalUpperOntology } from "@/lib/ontology/registry";

const TENANT = "default-tenant";

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  ensureCanonicalUpperOntology(db, "operator");
  db.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)`).run(TENANT, "Default");
  return db;
}

function seedOntology(db: Database.Database, candidateId: string) {
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
}

function insertCandidate(db: Database.Database, metadataJson: string, category = "engineering"): string {
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
     VALUES (?, ?, ?, 'codex', 'decision_intent', ?, ?, 'candidate', 'silver_candidate_claim', ?, ?)`,
  ).run(
    candidateId,
    TENANT,
    captureId,
    `batch39d body ${category}`,
    randomUUID().replace(/-/g, ""),
    metadataJson,
    new Date().toISOString(),
  );
  seedOntology(db, candidateId);
  return candidateId;
}

describe("belief promotion batch39d", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    db.close();
  });

  it.skip("canAdmitToGold throws at 803/824 when reviewOntology null — resolvedOntology is set before sensitive branches", () => {});

  it("promoteCandidate queues unlisted sensitive engineering through writeQueuedReceipt (804-816)", () => {
    const candidateId = insertCandidate(
      db,
      JSON.stringify({
        visibility: "internal",
        policy: "agent_visible",
        sensitivity: `unlisted-b39d-${randomUUID().slice(0, 6)}`,
      }),
    );
    const decision = promoteCandidate(db, {
      candidateId,
      tenantId: TENANT,
      actor: { id: "operator-b39d", role: "operator" },
      category: "engineering",
    });
    expect(decision.kind).toBe("queued_for_review");
    if (decision.kind !== "queued_for_review") return;
    expect(decision.reason).toBe("unlisted_sensitive_label");
  });

  it("promoteCandidate queues high-stakes pricing through writeQueuedReceipt (824-837)", () => {
    const candidateId = insertCandidate(
      db,
      JSON.stringify({ visibility: "public", policy: "agent_visible" }),
      "pricing",
    );
    const decision = promoteCandidate(db, {
      candidateId,
      tenantId: TENANT,
      actor: { id: "operator-b39d", role: "operator" },
      category: "pricing",
    });
    expect(decision.kind).toBe("queued_for_review");
    if (decision.kind !== "queued_for_review") return;
    expect(decision.reason).toBe("high_stakes_category");
  });

  it("canAdmitToGold throws ontology_context_unavailable without versioned record (892)", () => {
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
       VALUES (?, ?, ?, 'codex', 'decision_intent', ?, ?, 'candidate', 'silver_candidate_claim', ?, ?)`,
    ).run(
      candidateId,
      TENANT,
      captureId,
      "no ontology batch39d",
      randomUUID().replace(/-/g, ""),
      JSON.stringify({ visibility: "internal", policy: "agent_visible", sensitivity: "financial" }),
      new Date().toISOString(),
    );
    expect(() =>
      canAdmitToGold(db, TENANT, candidateId, {
        category: "engineering",
        actor: { id: "operator-b39d", role: "operator" },
      }),
    ).toThrow(/ontology_context_unavailable/);
  });

  it.skip("writeQueuedReceipt throws without ontology at 980 — queue writers always pass ontology coordinates", () => {});
});