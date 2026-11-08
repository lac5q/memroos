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
  const sourceHash = `sha256:${"9".repeat(64)}`;
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

function insertCandidate(
  db: Database.Database,
  metadataJson: string,
  opts: { withOntology?: boolean } = {},
): string {
  const withOntology = opts.withOntology !== false;
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
    "batch31 promotion body",
    randomUUID().replace(/-/g, ""),
    metadataJson,
    new Date().toISOString(),
  );
  if (withOntology) seedOntology(db, candidateId);
  return candidateId;
}

describe("belief promotion batch31 — queue and ontology reference paths", () => {
  // unreachable: writeQueuedReceipt defensive throw when ontology pair missing (980).

  let db: Database.Database;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    db.close();
  });

  it("promoteCandidate queues unlisted sensitive operational claims (803)", () => {
    const candidateId = insertCandidate(
      db,
      JSON.stringify({
        visibility: "internal",
        policy: "agent_visible",
        sensitivity: `unlisted-b31-${randomUUID().slice(0, 8)}`,
      }),
    );
    const decision = promoteCandidate(db, {
      candidateId,
      tenantId: TENANT,
      actor: { id: "operator-b31", role: "operator" },
      category: "operational",
    });
    expect(decision.kind).toBe("queued_for_review");
  });

  it("promoteCandidate queues legal_compliance high-stakes category (824)", () => {
    const candidateId = insertCandidate(
      db,
      JSON.stringify({ visibility: "public", policy: "agent_visible" }),
    );
    const decision = promoteCandidate(db, {
      candidateId,
      tenantId: TENANT,
      actor: { id: "operator-b31", role: "operator" },
      category: "legal_compliance",
    });
    expect(decision.kind).toBe("queued_for_review");
    if (decision.kind === "queued_for_review") {
      const row = db
        .prepare(`SELECT category FROM belief_review_queue WHERE id = ?`)
        .get(decision.queueId) as { category: string };
      expect(row.category).toBe("legal_compliance");
    }
  });

  it("canAdmitToGold throws ontology_context_unavailable without versioned record (892)", () => {
    const candidateId = insertCandidate(
      db,
      JSON.stringify({ visibility: "internal", policy: "agent_visible", sensitivity: "custom" }),
      { withOntology: false },
    );
    expect(() =>
      canAdmitToGold(db, TENANT, candidateId, {
        category: "operational",
        actor: { id: "operator-b31", role: "operator" },
      }),
    ).toThrow(/ontology_context_unavailable/);
  });
});
