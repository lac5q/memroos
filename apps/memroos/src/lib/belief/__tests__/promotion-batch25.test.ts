// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function insertCandidate(
  db: Database.Database,
  metadataJson: string | null,
  overrides?: { status?: string; beliefStage?: string; captureId?: string },
): string {
  const captureId = overrides?.captureId ?? randomUUID();
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
     VALUES (?, ?, ?, 'codex', 'decision_intent', ?, ?, ?, ?, ?, ?)`,
  ).run(
    candidateId,
    TENANT,
    captureId,
    "batch25 body",
    "e".repeat(64),
    overrides?.status ?? "candidate",
    overrides?.beliefStage ?? "silver_candidate_claim",
    metadataJson,
    new Date().toISOString(),
  );
  return candidateId;
}

describe("belief promotion batch25 — provenance, ontology resolve, demotion", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  it("evaluatePromotionChecks fails provenance when capture has no raw artifact", () => {
    const candidateId = insertCandidate(db, "{}");
    const captureId = db
      .prepare(`SELECT capture_id FROM agent_memory_candidates WHERE id = ?`)
      .get(candidateId) as { capture_id: string };
    db.prepare(`UPDATE agent_session_captures SET raw_artifact_id = NULL WHERE id = ?`).run(
      captureId.capture_id,
    );
    const checks = evaluatePromotionChecks(db, TENANT, candidateId);
    const provenance = checks.find((c) => c.name === "provenance");
    expect(provenance?.pass).toBe(false);
    expect(provenance?.evidence).toMatchObject({ reason: "no_raw_artifact" });
  });

  it("promoteCandidate tolerates metadata_json array via parseJsonRecord fallback", () => {
    const candidateId = insertCandidate(db, "[1,2,3]");
    const decision = promoteCandidate(db, {
      candidateId,
      tenantId: TENANT,
      actor: { id: "operator", role: "operator" },
      category: "operational",
    });
    expect(["admitted", "queued_for_review", "denied"]).toContain(decision.kind);
  });

  it("promoteCandidate throws ontology_context_unavailable for forged ontologyReference", () => {
    const candidateId = insertCandidate(db, JSON.stringify({ visibility: "public" }));
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
      }),
    ).toThrow(/ontology_context_unavailable/);
  });

  it("canAdmitToGold no-op returns existing receipt for already-gold candidate", () => {
    const candidateId = insertCandidate(db, "{}", {
      beliefStage: "gold_operational_truth",
      status: "promoted",
    });
    db.prepare(
      `INSERT INTO belief_promotion_decisions
         (id, tenant_id, candidate_id, category, decision_type, from_stage, to_stage,
          actor_id, actor_role, reason, metadata_json, entry_hash, created_at)
       VALUES (?, ?, ?, 'operational', 'promoted', 'silver_candidate_claim', 'gold_operational_truth',
               'operator', 'operator', 'seed', '{}', ?, ?)`,
    ).run(randomUUID(), TENANT, candidateId, "a".repeat(64), new Date().toISOString());

    const decision = canAdmitToGold(db, TENANT, candidateId, {
      actor: { id: "operator", role: "operator" },
      category: "operational",
    });
    expect(decision.kind).toBe("admitted");
  });

  it("demoteCandidate records manual demotion for silver candidate", () => {
    const candidateId = insertCandidate(db, "{}");
    const result = demoteCandidate(db, {
      candidateId,
      tenantId: TENANT,
      reason: "manual_operator",
      actor: { id: "operator", role: "operator" },
      category: "engineering",
    });
    expect(result.receipt.decisionType).toBe("demoted");
    const row = db
      .prepare(`SELECT belief_stage, demotion_reason FROM agent_memory_candidates WHERE id = ?`)
      .get(candidateId) as { belief_stage: string; demotion_reason: string };
    expect(row.belief_stage).toBe("silver_candidate_claim");
    expect(row.demotion_reason).toBe("manual_operator");
  });
});
