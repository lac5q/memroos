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
  const sourceHash = `sha256:${"e".repeat(64)}`;
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
  return { ontology, spaceId, sourceId, sourceHash, derivativeId, now };
}

function insertCandidate(db: Database.Database, metadataJson: string): string {
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
  ).run(candidateId, TENANT, captureId, "batch26 body", "f".repeat(64), metadataJson, new Date().toISOString());
  seedOntology(db, candidateId);
  return candidateId;
}

describe("belief promotion batch26 — unlisted sensitive, queue admit, actor role", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    db.close();
  });

  it("queues operational candidates with unlisted sensitive labels for review", () => {
    const candidateId = insertCandidate(
      db,
      JSON.stringify({ visibility: "public", policy: "agent_visible", sensitivity: "pii" }),
    );
    const decision = promoteCandidate(db, {
      candidateId,
      tenantId: TENANT,
      actor: { id: "operator", role: "operator" },
      category: "operational",
    });
    expect(decision.kind).toBe("queued_for_review");
    expect(String(decision.reason ?? "")).toMatch(/unlisted_sensitive|high_stakes|queued/i);
  });

  it("canAdmitToGold rejects reviewedQueueId when queue item is not approved", () => {
    const candidateId = insertCandidate(
      db,
      JSON.stringify({ visibility: "public", policy: "agent_visible" }),
    );
    const queueId = randomUUID();
    db.prepare(
      `INSERT INTO belief_review_queue
         (id, tenant_id, candidate_id, category, status, opened_by, opened_at,
          ontology_record_type, ontology_record_id, ontology_space_id, ontology_id, ontology_version,
          ontology_content_hash, ontology_canonical_id, ontology_source_id,
          ontology_source_hash, ontology_derivative_id)
       VALUES (?, ?, ?, 'pricing', 'open', 'operator', datetime('now'),
               'belief_candidate', ?, 'belief-review-space', 'x', '1', 'hash', 'canon', 'src', 'sh', 'deriv')`,
    ).run(queueId, TENANT, candidateId, candidateId);
    expect(() =>
      canAdmitToGold(db, TENANT, candidateId, {
        actor: { id: "operator", role: "operator" },
        category: "pricing",
        reviewedQueueId: queueId,
      }),
    ).toThrow(/not approved/);
  });

  it("canAdmitToGold throws ontology_context_invalidated when approved queue ontology drifts", () => {
    const candidateId = insertCandidate(
      db,
      JSON.stringify({ visibility: "public", policy: "agent_visible" }),
    );
    const queued = promoteCandidate(db, {
      candidateId,
      tenantId: TENANT,
      actor: { id: "operator", role: "operator" },
      category: "pricing",
    });
    expect(queued.kind).toBe("queued_for_review");
    if (queued.kind !== "queued_for_review") return;
    db.prepare(`UPDATE belief_review_queue SET status = 'approved' WHERE id = ?`).run(queued.queueId);
    db.prepare(
      `UPDATE belief_review_queue SET ontology_content_hash = ? WHERE id = ?`,
    ).run("sha256:deadbeef", queued.queueId);
    expect(() =>
      canAdmitToGold(db, TENANT, candidateId, {
        actor: { id: "operator", role: "operator" },
        category: "pricing",
        reviewedQueueId: queued.queueId,
      }),
    ).toThrow(/ontology_context_invalidated/);
  });

  it("writeDeniedReceipt maps non-operator actors to system audit role", () => {
    const candidateId = insertCandidate(db, JSON.stringify({ visibility: "public" }));
    db.prepare(`UPDATE agent_session_captures SET raw_artifact_id = NULL WHERE id = (
      SELECT capture_id FROM agent_memory_candidates WHERE id = ?
    )`).run(candidateId);
    const decision = canAdmitToGold(db, TENANT, candidateId, {
      actor: { id: "codex-agent", role: "agent" },
      category: "operational",
    });
    expect(decision.kind).toBe("denied");
    const audit = db
      .prepare(
        `SELECT actor_role FROM audit_entries WHERE entity_id LIKE ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(`%${candidateId}%`) as { actor_role: string } | undefined;
    expect(audit?.actor_role).toBe("system");
  });

  it("promoteCandidate tolerates malformed metadata_json via parseJsonRecord empty fallback", () => {
    const candidateId = insertCandidate(db, "{not-json");
    const decision = promoteCandidate(db, {
      candidateId,
      tenantId: TENANT,
      actor: { id: "operator", role: "operator" },
      category: "operational",
    });
    expect(["admitted", "queued_for_review", "denied"]).toContain(decision.kind);
  });
});
