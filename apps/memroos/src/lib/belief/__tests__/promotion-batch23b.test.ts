// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { canAdmitToGold, evaluatePromotionChecks, normalizeCategory } from "../promotion";

const TENANT = "default-tenant";

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  db.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)`).run(TENANT, "Default");
  return db;
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
  ).run(candidateId, TENANT, captureId, "batch23b body", "d".repeat(64), metadataJson, new Date().toISOString());
  return candidateId;
}

describe("belief promotion batch23b — ontology guard and category normalization", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    db.close();
  });

  it("normalizeCategory maps unknown labels to unclassified", () => {
    expect(normalizeCategory("  CUSTOM  ")).toBe("unclassified");
  });

  it("canAdmitToGold throws ontology_context_unavailable when ontology reference is invalid", () => {
    const candidateId = insertCandidate(db, JSON.stringify({ visibility: "public", policy: "agent_visible" }));
    expect(() =>
      canAdmitToGold(db, TENANT, candidateId, {
        actor: { id: "operator", role: "operator" },
        category: "pricing",
        reviewedQueueId: randomUUID(),
      }),
    ).toThrow(/ontology_context_unavailable|ontology_context_invalidated/);
  });

  it("evaluatePromotionChecks returns deterministic checks for a seeded candidate", () => {
    const candidateId = insertCandidate(db, JSON.stringify({ visibility: "internal", policy: "agent_visible" }));
    const checks = evaluatePromotionChecks(db, TENANT, candidateId, {
      actor: { id: "operator", role: "operator" },
      category: "general",
    });
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every((check) => typeof check.pass === "boolean")).toBe(true);
  });
});
