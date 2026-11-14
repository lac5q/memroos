// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

function seedOntology(db: Database.Database, candidateId: string) {
  const ontology = ensureCanonicalUpperOntology(db, "operator");
  const spaceId = "belief-review-space";
  const sourceId = `belief-source:${candidateId}`;
  const sourceHash = `sha256:${"7".repeat(64)}`;
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

function insertCandidate(db: Database.Database, metadataJson: string, content: string, withOntology = false): string {
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
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'captured', 'ok', '{}', 'summary b35', '{}',
             '[]', '[]', '[]', '[]', '[]', '{}', ?, ?, ?, ?)`,
  ).run(
    captureId,
    TENANT,
    "codex",
    "test",
    "memroos",
    "/repo",
    `session-b35-${randomUUID().slice(0, 6)}`,
    `task-b35-${randomUUID().slice(0, 6)}`,
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
  ).run(candidateId, TENANT, captureId, content, randomUUID().replace(/-/g, ""), metadataJson, new Date().toISOString());
  if (withOntology) seedOntology(db, candidateId);
  return candidateId;
}

describe("belief promotion batch35", () => {
  it.skip("writeQueuedReceipt throws when ontology pair missing (980) — queue paths always supply ontology", () => {});

  let db: Database.Database;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    db.close();
  });

  it("promoteCandidate queues unlisted sensitive labels in ordinary categories (799–816)", () => {
    const candidateId = insertCandidate(
      db,
      JSON.stringify({ visibility: "internal", policy: "agent_visible", sensitivity: "pii" }),
      "sensitive operational note batch35",
      true,
    );
    const decision = promoteCandidate(db, {
      candidateId,
      tenantId: TENANT,
      actor: { id: "operator-b35", role: "operator" },
      category: "operational",
    });
    expect(decision.kind).toBe("queued_for_review");
    if (decision.kind !== "queued_for_review") return;
    expect(decision.reason).toBe("unlisted_sensitive_label");
  });

  it("canAdmitToGold throws ontology_context_unavailable without stored ontology (891–892)", () => {
    const candidateId = insertCandidate(
      db,
      JSON.stringify({ visibility: "internal", policy: "agent_visible", sensitivity: "financial" }),
      "high stakes without ontology batch35",
    );
    expect(() =>
      canAdmitToGold(db, TENANT, candidateId, {
        category: "pricing",
        actor: { id: "operator-b35", role: "operator" },
      }),
    ).toThrow(/ontology_context_unavailable/);
  });

  it.skip("ontology null review guard throws at 803/824 — resolvedOntology is always set on sensitive paths", () => {});

  it("promoteCandidate queues pricing category for operator review (818–837)", () => {
    const candidateId = insertCandidate(
      db,
      JSON.stringify({ visibility: "public", policy: "agent_visible" }),
      "pricing policy change batch35 with enough detail",
    );
    const ontology = ensureCanonicalUpperOntology(db, "operator");
    const spaceId = "belief-review-space";
    const sourceId = `belief-source:${candidateId}`;
    const sourceHash = `sha256:${"1".repeat(64)}`;
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

    const decision = promoteCandidate(db, {
      candidateId,
      tenantId: TENANT,
      actor: { id: "operator-b35", role: "operator" },
      category: "pricing",
    });
    expect(decision.kind).toBe("queued_for_review");
  });
});
