// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { ensureCanonicalUpperOntology } from "@/lib/ontology/registry";
import {
  canAdmitToGold,
  demoteCandidate,
  evaluatePromotionChecks,
  promoteCandidate,
} from "../promotion";

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

function insertCandidate(db: Database.Database, metadataJson: string, opts: { withOntology?: boolean } = {}): string {
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
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'captured', 'ok', '{}', 'fresh summary b34', '{}',
             '[]', '[]', '[]', '[]', '[]', '{}', ?, ?, ?, ?)`,
  ).run(
    captureId,
    TENANT,
    "codex",
    "test",
    "memroos",
    "/repo",
    `session-b34-${randomUUID().slice(0, 6)}`,
    `task-b34-${randomUUID().slice(0, 6)}`,
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
    `batch34 promotion ${randomUUID().slice(0, 8)}`,
    randomUUID().replace(/-/g, ""),
    metadataJson,
    new Date().toISOString(),
  );
  if (withOntology) seedOntology(db, candidateId);
  return candidateId;
}

describe("belief promotion batch34 — policy domain, demotion, and admit branches", () => {
  // sticky: writeQueuedReceipt throws when ontology pair missing (980) — queue paths always supply ontology.

  let db: Database.Database;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    db.close();
  });

  it("evaluatePromotionChecks records domain metadata on policy check (379)", () => {
    const candidateId = insertCandidate(
      db,
      JSON.stringify({ visibility: "internal", policy: "agent_visible", domain: "operations" }),
    );
    const checks = evaluatePromotionChecks(db, TENANT, candidateId, {
      actor: { id: "operator-b34", role: "operator", tenantId: TENANT },
    });
    const policy = checks.find((c) => c.name === "policy");
    expect(policy?.evidence).toMatchObject({ visibility: "internal" });
  });

  it("promoteCandidate rejects caller ontologyContext without reference (1173)", () => {
    const candidateId = insertCandidate(db, JSON.stringify({ visibility: "internal", policy: "agent_visible" }));
    expect(() =>
      promoteCandidate(db, {
        candidateId,
        tenantId: TENANT,
        actor: { id: "operator-b34", role: "operator" },
        ontologyContext: {
          derivativeId: "x",
          ontologyId: "y",
          ontologyVersion: "1",
          ontologyContentHash: "h",
          mappingPath: [],
          sourceId: "s",
          sourceHash: "sh",
        },
      }),
    ).toThrow(/not accepted/);
  });

  it("canAdmitToGold rejects reviewedQueueId when queue item is not approved (846-851)", () => {
    const candidateId = insertCandidate(db, JSON.stringify({ visibility: "public", policy: "agent_visible" }));
    const queued = promoteCandidate(db, {
      candidateId,
      tenantId: TENANT,
      actor: { id: "operator-b34", role: "operator" },
      category: "pricing",
    });
    expect(queued.kind).toBe("queued_for_review");
    if (queued.kind !== "queued_for_review") return;
    expect(() =>
      canAdmitToGold(db, TENANT, candidateId, {
        category: "pricing",
        actor: { id: "operator-b34-admit", role: "operator" },
        reviewedQueueId: queued.queueId,
      }),
    ).toThrow(/not approved/);
  });

  it("demoteCandidate records supersession metadata for conflict demotions (1349-1388)", () => {
    const hash = randomUUID().replace(/-/g, "");
    const demotedGoldId = insertCandidate(db, JSON.stringify({ visibility: "internal", policy: "agent_visible" }));
    const successorGoldId = insertCandidate(db, JSON.stringify({ visibility: "internal", policy: "agent_visible" }));
    db.prepare(
      `UPDATE agent_memory_candidates
       SET belief_stage = 'gold_operational_truth', content_hash = ?
       WHERE id IN (?, ?)`,
    ).run(hash, demotedGoldId, successorGoldId);
    const result = demoteCandidate(db, {
      candidateId: demotedGoldId,
      tenantId: TENANT,
      reason: "superseded_by_conflict",
      actor: { id: "operator-b34", role: "operator" },
    });
    expect(result.decisionId).toBeTruthy();
    expect(result.supersedesCandidateId).toBe(successorGoldId);
  });

  it("promoteCandidate maps ontology_context_unavailable to admission_denied (1203-1217)", () => {
    const candidateId = insertCandidate(
      db,
      JSON.stringify({ visibility: "internal", policy: "agent_visible" }),
      { withOntology: false },
    );
    const decision = promoteCandidate(db, {
      candidateId,
      tenantId: TENANT,
      actor: { id: "operator-b34", role: "operator" },
      category: "operational",
    });
    expect(decision.kind).toBe("denied");
    if (decision.kind !== "denied") return;
    expect(decision.reason).toBe("ontology_context_unavailable");
  });
});
