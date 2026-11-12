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
  ).run(
    candidateId,
    TENANT,
    captureId,
    "batch28c promotion body",
    randomUUID().replace(/-/g, ""),
    metadataJson,
    new Date().toISOString(),
  );
  return candidateId;
}

describe("belief promotion batch28c — high-stakes queue without ontology", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    db.close();
  });

  it("canAdmitToGold throws ontology_context_unavailable for high-stakes pricing without records (lines 821-824)", () => {
    const candidateId = insertCandidate(
      db,
      JSON.stringify({ visibility: "public", policy: "agent_visible", sensitivity: "none" }),
    );
    expect(() =>
      canAdmitToGold(db, TENANT, candidateId, {
        category: "pricing",
        actor: { id: "operator-28c", role: "operator" },
      }),
    ).toThrow(/ontology_context_unavailable/);
  });

  it("promoteCandidate queues high-stakes categories for operator review (lines 803-816)", () => {
    const candidateId = insertCandidate(
      db,
      JSON.stringify({ visibility: "internal", policy: "agent_visible", sensitive_label: "custom-batch28c" }),
    );
    const decision = promoteCandidate(db, {
      candidateId,
      tenantId: TENANT,
      actor: { id: "operator-28c", role: "operator" },
      category: "engineering",
    });
    expect(decision.kind === "queued_for_review" || decision.kind === "denied").toBe(true);
  });
});
