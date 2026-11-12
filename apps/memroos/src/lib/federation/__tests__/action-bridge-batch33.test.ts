// @vitest-environment node
import crypto from "node:crypto";
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
  tenantId: "tenant-b33",
  spaceId: "space-b33",
  federationRunId: "federation-run-b33",
  packHash: "sha256:pack-b33",
  ontologyRecords: [{ recordType: "message", recordId: "42" }],
};

function seedMerge() {
  db.prepare(
    `INSERT INTO federation_merges
      (id, tenant_id, federation_run_id, pack_hash, pack_bytes, pack_item_count, contributing_source_ids, contributing_outcome_ids, dedupe_metadata_json, rank_metadata_json, budget_metadata_json, bound_status, scope_hash)
     VALUES ('merge-b33', 'tenant-b33', 'federation-run-b33', 'sha256:pack-b33', 64, 1, '["source-b33"]', '["outcome-b33"]', '{}', '{}', '{}', 'bounded', 'sha256:scope-b33')`,
  ).run();
}

beforeEach(async () => {
  testDbDir = path.join(os.tmpdir(), `federation-ab-b33-${crypto.randomUUID()}`);
  fs.mkdirSync(testDbDir, { recursive: true });
  process.env.SQLITE_DB_PATH = path.join(testDbDir, "federation.db");
  vi.resetModules();
  const { getDb, closeDb: close } = await import("@/lib/db");
  const { initSchema } = await import("@/lib/db-schema");
  db = getDb();
  initSchema(db);
  closeDb = close;
  db.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-b33', 'Tenant B33')").run();
  db.prepare(
    `INSERT INTO federation_sources
      (id, tenant_id, source_handle, source_kind, space_id, purpose, allowed_operations_json, trust_level, enabled, has_expiry, transport, descriptor_json, registration_hash, created_by)
     VALUES ('source-b33', 'tenant-b33', 'memory-b33', 'memory', 'space-b33', 'orchestration', '["search"]', 'trusted', 1, 0, 'local', '{}', 'sha256:registration', 'operator')`,
  ).run();
  db.prepare(
    `INSERT INTO federation_source_outcomes
      (id, tenant_id, federation_run_id, source_id, outcome, reason_code, policy_decision, policy_version, result_count, result_bytes, duration_ms, scope_hash)
     VALUES ('outcome-b33', 'tenant-b33', 'federation-run-b33', 'source-b33', 'success', 'ok', 'allow', 'federation-v1', 1, 64, 1, 'sha256:scope-b33')`,
  ).run();
  seedMerge();
  db.prepare(
    `INSERT INTO federation_merged_coordinates
      (id, tenant_id, federation_run_id, pack_hash, canonical_id, canonical_hash, source_id)
     VALUES ('coordinate-b33', 'tenant-b33', 'federation-run-b33', 'sha256:pack-b33', 'canonical-42', 'sha256:canonical-42', 'source-b33')`,
  ).run();
});

afterEach(() => {
  closeDb();
  fs.rmSync(testDbDir, { recursive: true, force: true });
});

describe("federation action-bridge batch33", () => {
  it("artifactHasActiveCoordinateLedger returns false when coordinates drift (233)", async () => {
    const { persistFederationActionArtifact } = await import("../action-bridge");
    const created = persistFederationActionArtifact(db, baseInput);
    expect(created.status).toBe("ready");
    if (created.status !== "ready") return;
    db.prepare(`UPDATE federation_action_derivatives SET status = 'invalidated' WHERE artifact_id = ?`).run(
      created.artifact.id,
    );
    const retry = persistFederationActionArtifact(db, baseInput);
    expect(retry.status).toBe("denied");
    expect(retry.reason).toBe("federation_artifact_mismatch");
  });

  it("returns unavailable when existing artifact status is not active (333)", async () => {
    const { persistFederationActionArtifact } = await import("../action-bridge");
    const created = persistFederationActionArtifact(db, baseInput);
    expect(created.status).toBe("ready");
    if (created.status !== "ready") return;
    db.prepare(`UPDATE federation_action_artifacts SET status = 'invalidated' WHERE id = ?`).run(created.artifact.id);
    const retry = persistFederationActionArtifact(db, baseInput);
    expect(retry.status).toBe("unavailable");
    expect(retry.reason).toBe("federation_artifact_invalidated");
  });
});
