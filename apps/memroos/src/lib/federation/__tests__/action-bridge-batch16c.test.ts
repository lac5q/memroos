// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ontology/validity", () => ({
  resolveOntologyValidity: vi.fn((_db, input) => ({
    ontologyId: "memroos.core",
    ontologyVersion: "1.0.0",
    ontologyContentHash: "sha256:ontology",
    namespace: "memroos",
    canonicalId: "memroos.Document",
    aliasMigrationPath: [],
    sourceId: "ontology-source",
    sourceHash: "sha256:ontology-source",
    derivativeType: "versioned_record",
    derivativeId: `${input.recordType}:${input.recordId}`,
  })),
}));

let db: import("better-sqlite3").Database;
let closeDb: () => void;
let testDbDir: string;

const baseInput = {
  tenantId: "tenant-a",
  spaceId: "space-a",
  federationRunId: "federation-run-1",
  packHash: "sha256:pack",
  ontologyRecords: [{ recordType: "message", recordId: "42" }],
};

beforeEach(async () => {
  testDbDir = path.join(os.tmpdir(), `federation-b16c-${crypto.randomUUID()}`);
  fs.mkdirSync(testDbDir, { recursive: true });
  process.env.SQLITE_DB_PATH = path.join(testDbDir, "federation.db");
  vi.resetModules();
  const { getDb, closeDb: close } = await import("@/lib/db");
  const { initSchema } = await import("@/lib/db-schema");
  db = getDb();
  initSchema(db);
  closeDb = close;
  db.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-a', 'Tenant A')").run();
  db.prepare(
    `INSERT INTO federation_sources
      (id, tenant_id, source_handle, source_kind, space_id, purpose, allowed_operations_json, trust_level, enabled, has_expiry, transport, descriptor_json, registration_hash, created_by)
     VALUES ('source-1', 'tenant-a', 'memory-a', 'memory', 'space-a', 'orchestration', '["search"]', 'trusted', 1, 0, 'local', '{}', 'sha256:registration', 'operator')`,
  ).run();
  db.prepare(
    `INSERT INTO federation_source_outcomes
      (id, tenant_id, federation_run_id, source_id, outcome, reason_code, policy_decision, policy_version, result_count, result_bytes, duration_ms, scope_hash)
     VALUES ('outcome-1', 'tenant-a', 'federation-run-1', 'source-1', 'success', 'ok', 'allow', 'federation-v1', 1, 64, 1, 'sha256:scope')`,
  ).run();
  db.prepare(
    `INSERT INTO federation_merges
      (id, tenant_id, federation_run_id, pack_hash, pack_bytes, pack_item_count, contributing_source_ids, contributing_outcome_ids, dedupe_metadata_json, rank_metadata_json, budget_metadata_json, bound_status, scope_hash)
     VALUES ('merge-1', 'tenant-a', 'federation-run-1', 'sha256:pack', 64, 1, '["source-1"]', '["outcome-1"]', '{}', '{}', '{}', 'bounded', 'sha256:scope')`,
  ).run();
  db.prepare(
    `INSERT INTO federation_merged_coordinates
      (id, tenant_id, federation_run_id, pack_hash, canonical_id, canonical_hash, source_id)
     VALUES ('coordinate-merge-1', 'tenant-a', 'federation-run-1', 'sha256:pack', 'canonical-42', 'sha256:canonical-42', 'source-1')`,
  ).run();
});

afterEach(() => {
  closeDb();
  fs.rmSync(testDbDir, { recursive: true, force: true });
});

describe("federation action-bridge batch16c — source invalidation", () => {
  it("invalidateFederationArtifactsForSource marks artifacts inactive by source id", async () => {
    const { persistFederationActionArtifact, invalidateFederationArtifactsForSource } = await import(
      "../action-bridge"
    );
    const created = persistFederationActionArtifact(db, baseInput);
    expect(created.status).toBe("ready");
    if (created.status !== "ready") return;

    const result = invalidateFederationArtifactsForSource(db, {
      tenantId: "tenant-a",
      sourceId: "source-1",
      erasureId: `erasure_${crypto.randomUUID()}`,
    });
    expect(result.invalidated).toBeGreaterThanOrEqual(1);
    const row = db
      .prepare(`SELECT status FROM federation_action_artifacts WHERE id = ?`)
      .get(created.artifact.id) as { status: string };
    expect(row.status).toBe("invalidated");
  });

  it("persistFederationActionArtifact denies when ontologyRecords array is empty", async () => {
    const { persistFederationActionArtifact } = await import("../action-bridge");
    const denied = persistFederationActionArtifact(db, { ...baseInput, ontologyRecords: [] });
    expect(denied.status).not.toBe("ready");
    if (denied.status === "ready") return;
    expect(denied.reason).toBe("ontology_context_unavailable");
  });
});
