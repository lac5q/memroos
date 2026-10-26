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

const input = {
  tenantId: "tenant-a",
  spaceId: "space-a",
  federationRunId: "federation-run-1",
  packHash: "sha256:pack",
  ontologyRecords: [{ recordType: "message", recordId: "42" }],
};

beforeEach(async () => {
  testDbDir = path.join(os.tmpdir(), `federation-b15-${crypto.randomUUID()}`);
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
     VALUES ('coordinate-1', 'tenant-a', 'federation-run-1', 'sha256:pack', 'canonical-42', 'sha256:canonical-42', 'source-1')`,
  ).run();
});

afterEach(() => {
  closeDb();
  fs.rmSync(testDbDir, { recursive: true, force: true });
});

describe("federation action-bridge batch15 — validateInput and proof edges", () => {
  it("validateInput denies missing ontology records and malformed ids", async () => {
    const { persistFederationActionArtifact } = await import("../action-bridge");
    expect(persistFederationActionArtifact(db, { ...input, ontologyRecords: [] }).reason).toBe(
      "ontology_context_unavailable",
    );
    expect(
      persistFederationActionArtifact(db, {
        ...input,
        ontologyRecords: [{ recordType: " ", recordId: "42" }],
      }).reason,
    ).toBe("ontology_context_unavailable");
  });

  it("parseIds rejects arrays containing non-string entries via malformed merge JSON", async () => {
    const { persistFederationActionArtifact } = await import("../action-bridge");
    db.prepare(
      `INSERT INTO federation_merges
        (id, tenant_id, federation_run_id, pack_hash, pack_bytes, pack_item_count, contributing_source_ids, contributing_outcome_ids, dedupe_metadata_json, rank_metadata_json, budget_metadata_json, bound_status, scope_hash)
       VALUES ('merge-bad2', 'tenant-a', 'run-bad2', 'sha256:pack-bad2', 1, 1, '[1]', '["outcome-1"]', '{}', '{}', '{}', 'bounded', 'sha256:scope')`,
    ).run();
    const result = persistFederationActionArtifact(db, {
      ...input,
      federationRunId: "run-bad2",
      packHash: "sha256:pack-bad2",
    });
    expect(result.status).toBe("unavailable");
    expect(result.reason).toBe("federation_merge_malformed");
  });

  it("resolveFederationActionProof fails when ontology_refs_json is corrupt", async () => {
    const { persistFederationActionArtifact, resolveFederationActionProof } = await import("../action-bridge");
    const created = persistFederationActionArtifact(db, input);
    expect(created.status).toBe("ready");
    if (created.status !== "ready") return;
    db.prepare(`UPDATE federation_action_artifacts SET ontology_refs_json = '{bad' WHERE id = ?`).run(
      created.artifact.id,
    );
    const resolved = resolveFederationActionProof(db, {
      tenantId: "tenant-a",
      spaceId: "space-a",
      artifactId: created.artifact.id,
    });
    expect(resolved.status).toBe("unavailable");
    expect(resolved.reason).toBe("ontology_context_unavailable");
  });
});
