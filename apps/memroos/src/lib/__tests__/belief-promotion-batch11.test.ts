// @vitest-environment node
import crypto from "crypto";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "../db-schema";
import {
  canAdmitToGold,
  demoteCandidate,
  evaluatePromotionChecks,
  promoteCandidate,
  resolveReview,
} from "../belief/promotion";
import { ensureCanonicalUpperOntology } from "../ontology/registry";
import { revokeOntologySource } from "../ontology/validity";

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
    "batch11 content",
    crypto.createHash("sha256").update("batch11 content").digest("hex"),
    JSON.stringify({ visibility: "internal", policy: "agent_visible" }),
    new Date().toISOString()
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

describe("belief promotion batch11", () => {
  let db: Database.Database;
  const previousInternalKey = process.env.MEMROOS_INTERNAL_API_KEY;

  beforeEach(() => {
    delete process.env.MEMROOS_INTERNAL_API_KEY;
    db = freshDb();
  });

  afterEach(() => {
    db.close();
    if (previousInternalKey === undefined) delete process.env.MEMROOS_INTERNAL_API_KEY;
    else process.env.MEMROOS_INTERNAL_API_KEY = previousInternalKey;
  });

  it("readCandidate throws when promoting an unknown candidate id", () => {
    expect(() =>
      promoteCandidate(db, {
        candidateId: crypto.randomUUID(),
        tenantId: TENANT,
        actor: { id: "operator", role: "operator" },
        category: "operational",
      })
    ).toThrow(/candidate not found/);
  });

  it("evaluatePromotionChecks fails dedupe when candidate is already gold", () => {
    const { candidateId } = insertMinimalCandidate(db);
    promoteCandidate(db, {
      candidateId,
      tenantId: TENANT,
      actor: { id: "operator", role: "operator" },
      category: "operational",
    });
    const dedupe = evaluatePromotionChecks(db, TENANT, candidateId).find((c) => c.name === "dedupe");
    expect(dedupe?.pass).toBe(false);
    expect(dedupe?.evidence).toMatchObject({ reason: "already_gold" });
  });

  it("promoteCandidate throws ontology_context_unavailable for invalid ontologyReference", () => {
    const { candidateId } = insertMinimalCandidate(db);
    expect(() =>
      promoteCandidate(db, {
        candidateId,
        tenantId: TENANT,
        actor: { id: "operator", role: "operator" },
        category: "operational",
        ontologyReference: {
          tenantId: TENANT,
          spaceId: "missing-space",
          recordType: "belief_candidate",
          recordId: candidateId,
        },
      })
    ).toThrow(/ontology_context_unavailable/);
  });

  it("canAdmitToGold throws ontology_context_invalidated when reviewed queue ontology is revoked", () => {
    const { candidateId } = insertMinimalCandidate(db);
    const queued = promoteCandidate(db, {
      candidateId,
      tenantId: TENANT,
      actor: { id: "operator", role: "operator" },
      category: "pricing",
    });
    expect(queued.kind).toBe("queued_for_review");
    if (queued.kind !== "queued_for_review") throw new Error("expected queue");

    const row = db
      .prepare(`SELECT ontology_source_id, ontology_source_hash, ontology_space_id FROM belief_review_queue WHERE id = ?`)
      .get(queued.queueId) as { ontology_source_id: string; ontology_source_hash: string; ontology_space_id: string };
    revokeOntologySource(db, {
      tenantId: TENANT,
      spaceId: row.ontology_space_id,
      sourceId: row.ontology_source_id,
      sourceHash: row.ontology_source_hash,
      actor: "operator",
      reason: "source_erased",
    });

    expect(() =>
      canAdmitToGold(db, TENANT, candidateId, {
        actor: { id: "operator-2", role: "operator" },
        category: "pricing",
        reviewedQueueId: queued.queueId,
      })
    ).toThrow(/ontology_context_invalidated/);
  });

  it("resolveReview returns admission_denied when queue ontology is invalidated at approve time", () => {
    const { candidateId } = insertMinimalCandidate(db);
    const queued = promoteCandidate(db, {
      candidateId,
      tenantId: TENANT,
      actor: { id: "operator", role: "operator" },
      category: "pricing",
    });
    expect(queued.kind).toBe("queued_for_review");
    if (queued.kind !== "queued_for_review") throw new Error("expected queue");

    const row = db
      .prepare(`SELECT ontology_source_id, ontology_source_hash, ontology_space_id FROM belief_review_queue WHERE id = ?`)
      .get(queued.queueId) as { ontology_source_id: string; ontology_source_hash: string; ontology_space_id: string };
    revokeOntologySource(db, {
      tenantId: TENANT,
      spaceId: row.ontology_space_id,
      sourceId: row.ontology_source_id,
      sourceHash: row.ontology_source_hash,
      actor: "operator",
      reason: "source_erased",
    });

    const resolved = resolveReview(db, {
      queueId: queued.queueId,
      tenantId: TENANT,
      resolution: "approved",
      operatorId: "operator-2",
      category: "pricing",
    });
    expect(resolved.admission.kind).toBe("denied");
    if (resolved.admission.kind === "denied") {
      expect(resolved.admission.reason).toMatch(/ontology_context_invalidated/);
    }
  });

  it("demoteCandidate throws when candidate id does not exist", () => {
    expect(() =>
      demoteCandidate(db, {
        candidateId: crypto.randomUUID(),
        tenantId: TENANT,
        reason: "manual",
        actor: { id: "operator", role: "operator" },
      })
    ).toThrow(/candidate not found/);
  });

  it("parseJsonRecord tolerates malformed metadata on demotion", () => {
    const { candidateId } = insertMinimalCandidate(db);
    db.prepare(`UPDATE agent_memory_candidates SET metadata_json = 'not-json' WHERE id = ?`).run(candidateId);
    promoteCandidate(db, {
      candidateId,
      tenantId: TENANT,
      actor: { id: "operator", role: "operator" },
      category: "operational",
    });
    const demote = demoteCandidate(db, {
      candidateId,
      tenantId: TENANT,
      reason: "test_demote",
      actor: { id: "operator", role: "operator" },
    });
    expect(demote.decisionId).toBeTruthy();
  });

  it("parseJsonRecord treats JSON arrays in metadata as empty objects", () => {
    const { candidateId } = insertMinimalCandidate(db);
    db.prepare(`UPDATE agent_memory_candidates SET metadata_json = '["not","metadata"]' WHERE id = ?`).run(
      candidateId
    );
    promoteCandidate(db, {
      candidateId,
      tenantId: TENANT,
      actor: { id: "operator", role: "operator" },
      category: "operational",
    });
    expect(
      demoteCandidate(db, {
        candidateId,
        tenantId: TENANT,
        reason: "array_metadata",
        actor: { id: "operator", role: "operator" },
      }).decisionId
    ).toBeTruthy();
  });

  it("promoteCandidate throws when the gold UPDATE affects zero rows", () => {
    const { candidateId } = insertMinimalCandidate(db);
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql: unknown) => {
      const stmt = originalPrepare(sql as string);
      if (typeof sql === "string" && sql.includes("belief_stage = 'gold_operational_truth'")) {
        vi.spyOn(stmt, "run").mockReturnValue({ changes: 0 } as never);
      }
      return stmt;
    });
    expect(() =>
      promoteCandidate(db, {
        candidateId,
        tenantId: TENANT,
        actor: { id: "operator", role: "operator" },
        category: "operational",
      })
    ).toThrow(/expected 1/);
    vi.restoreAllMocks();
  });

  it("demoteCandidate throws when the demotion UPDATE affects zero rows", () => {
    const { candidateId } = insertMinimalCandidate(db);
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql: unknown) => {
      const stmt = originalPrepare(sql as string);
      if (
        typeof sql === "string" &&
        sql.includes("belief_stage = ?") &&
        sql.includes("demotion_reason = ?")
      ) {
        vi.spyOn(stmt, "run").mockReturnValue({ changes: 0 } as never);
      }
      return stmt;
    });
    expect(() =>
      demoteCandidate(db, {
        candidateId,
        tenantId: TENANT,
        reason: "zero_row_demote",
        actor: { id: "operator", role: "operator" },
      })
    ).toThrow(/expected 1/);
    vi.restoreAllMocks();
  });

  it("resolveReview rethrows when approved admission fails for a non-ontology gate", () => {
    const { candidateId, captureId } = insertMinimalCandidate(db);
    const queued = promoteCandidate(db, {
      candidateId,
      tenantId: TENANT,
      actor: { id: "operator", role: "operator" },
      category: "pricing",
    });
    expect(queued.kind).toBe("queued_for_review");
    if (queued.kind !== "queued_for_review") throw new Error("expected queue");
    db.prepare(`UPDATE agent_session_captures SET captured_at = ? WHERE id = ?`).run(
      "1999-01-01T00:00:00.000Z",
      captureId
    );
    expect(() =>
      resolveReview(db, {
        queueId: queued.queueId,
        tenantId: TENANT,
        resolution: "approved",
        operatorId: "operator-2",
        category: "pricing",
      })
    ).toThrow(/review-approved candidate failed admission gate/);
  });
});
