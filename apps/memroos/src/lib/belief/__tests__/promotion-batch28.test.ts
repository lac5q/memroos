// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { ensureCanonicalUpperOntology } from "@/lib/ontology/registry";
import {
  demoteCandidate,
  enqueueForReview,
  evaluatePromotionChecks,
  listOpenReviews,
  normalizeCategory,
  promoteCandidate,
  resolveReview,
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
}

function insertCandidate(
  db: Database.Database,
  metadataJson: string,
  opts: { withOntology?: boolean; contentHash?: string; stage?: string } = {},
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
  const contentHash = opts.contentHash ?? randomUUID().replace(/-/g, "");
  db.prepare(
    `INSERT INTO agent_memory_candidates
       (id, tenant_id, capture_id, agent_id, memory_type, content, content_hash, status,
        belief_stage, metadata_json, created_at)
     VALUES (?, ?, ?, 'codex', 'decision_intent', ?, ?, 'candidate', ?, ?, ?)`,
  ).run(
    candidateId,
    TENANT,
    captureId,
    "batch28 body",
    contentHash,
    opts.stage ?? "silver_candidate_claim",
    metadataJson,
    new Date().toISOString(),
  );
  if (withOntology) seedOntology(db, candidateId);
  return candidateId;
}

describe("belief promotion batch28 — normalizeCategory, demote, resolve reject, list reviews", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    db.close();
  });

  it("normalizeCategory maps known labels and falls back to unclassified", () => {
    expect(normalizeCategory("  ENGINEERING ")).toBe("engineering");
    expect(normalizeCategory("not-a-real-category")).toBe("unclassified");
    expect(normalizeCategory(null)).toBe("unclassified");
  });

  it("demoteCandidate records operator demotion from silver", () => {
    const candidateId = insertCandidate(db, JSON.stringify({ visibility: "internal", policy: "agent_visible" }));
    const result = demoteCandidate(db, {
      candidateId,
      tenantId: TENANT,
      reason: "operator_correction",
      category: "engineering",
      actor: { id: "operator", role: "operator" },
    });
    expect(result.receipt.decisionType).toBe("demoted");
    const row = db
      .prepare(`SELECT belief_stage, demotion_reason FROM agent_memory_candidates WHERE id = ?`)
      .get(candidateId) as { belief_stage: string; demotion_reason: string };
    expect(row.belief_stage).toBe("silver_candidate_claim");
    expect(row.demotion_reason).toBe("operator_correction");
  });

  it("resolveReview rejected closes queue item and marks candidate rejected", () => {
    const candidateId = insertCandidate(db, JSON.stringify({ visibility: "public", policy: "agent_visible" }));
    const queued = promoteCandidate(db, {
      candidateId,
      tenantId: TENANT,
      actor: { id: "operator", role: "operator" },
      category: "pricing",
    });
    expect(queued.kind).toBe("queued_for_review");
    if (queued.kind !== "queued_for_review") return;

    const resolved = resolveReview(db, {
      queueId: queued.queueId,
      tenantId: TENANT,
      resolution: "rejected",
      operatorId: "operator-batch28",
      note: "not credible",
    });
    expect(resolved.resolution).toBe("rejected");
    expect(resolved.admission).toBeNull();
    const status = db.prepare(`SELECT status FROM agent_memory_candidates WHERE id = ?`).get(candidateId) as {
      status: string;
    };
    expect(status.status).toBe("rejected");
    expect(listOpenReviews(db, { tenantId: TENANT }).some((r) => r.candidateId === candidateId)).toBe(false);
  });

  it("resolveReview throws when queue item is no longer open", () => {
    const candidateId = insertCandidate(db, JSON.stringify({ visibility: "public", policy: "agent_visible" }));
    const { queueId } = enqueueForReview(db, {
      candidateId,
      tenantId: TENANT,
      category: "pricing",
      actor: { id: "operator", role: "operator" },
    });
    db.prepare(`UPDATE belief_review_queue SET status = 'rejected' WHERE id = ?`).run(queueId);
    expect(() =>
      resolveReview(db, {
        queueId,
        tenantId: TENANT,
        resolution: "rejected",
        operatorId: "operator",
      }),
    ).toThrow(/already rejected/);
  });

  it("evaluatePromotionChecks returns five deterministic checks for a seeded candidate", () => {
    const candidateId = insertCandidate(db, JSON.stringify({ visibility: "internal", policy: "agent_visible" }));
    const checks = evaluatePromotionChecks(db, TENANT, candidateId);
    expect(checks).toHaveLength(5);
    expect(checks.every((c) => typeof c.pass === "boolean")).toBe(true);
  });
});
