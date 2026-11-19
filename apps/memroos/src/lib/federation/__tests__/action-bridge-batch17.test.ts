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

function seedMerge(
  overrides: Partial<{
    id: string;
    runId: string;
    packHash: string;
    boundStatus: string;
    packItemCount: number;
    packBytes: number;
    sourceIds: string;
    outcomeIds: string;
    scopeHash: string;
  }> = {},
) {
  const id = overrides.id ?? "merge-1";
  const runId = overrides.runId ?? "federation-run-1";
  const packHash = overrides.packHash ?? "sha256:pack";
  db.prepare(
    `INSERT INTO federation_merges
      (id, tenant_id, federation_run_id, pack_hash, pack_bytes, pack_item_count, contributing_source_ids, contributing_outcome_ids, dedupe_metadata_json, rank_metadata_json, budget_metadata_json, bound_status, scope_hash)
     VALUES (?, 'tenant-a', ?, ?, ?, ?, ?, ?, '{}', '{}', '{}', ?, ?)`,
  ).run(
    id,
    runId,
    packHash,
    overrides.packBytes ?? 64,
    overrides.packItemCount ?? 1,
    overrides.sourceIds ?? '["source-1"]',
    overrides.outcomeIds ?? '["outcome-1"]',
    overrides.boundStatus ?? "bounded",
    overrides.scopeHash ?? "sha256:scope",
  );
  db.prepare(
    `INSERT INTO federation_merged_coordinates
      (id, tenant_id, federation_run_id, pack_hash, canonical_id, canonical_hash, source_id)
     VALUES (?, 'tenant-a', ?, ?, 'canonical-42', 'sha256:canonical-42', 'source-1')`,
  ).run(`coordinate-${id}`, runId, packHash);
}

beforeEach(async () => {
  testDbDir = path.join(os.tmpdir(), `federation-b17-${crypto.randomUUID()}`);
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
  seedMerge();
});

afterEach(() => {
  closeDb();
  fs.rmSync(testDbDir, { recursive: true, force: true });
});

describe("federation action-bridge batch17 — ontology and outcome guard rails", () => {
  it("persistFederationActionArtifact denies empty ontology records", async () => {
    const { persistFederationActionArtifact } = await import("../action-bridge");
    expect(
      persistFederationActionArtifact(db, { ...baseInput, ontologyRecords: [] }).reason,
    ).toBe("ontology_context_unavailable");
    expect(
      persistFederationActionArtifact(db, {
        ...baseInput,
        ontologyRecords: [{ recordType: " ", recordId: "42" }],
      }).reason,
    ).toBe("ontology_context_unavailable");
  });

  it("persistFederationActionArtifact unavailable when outcomes fail policy scope checks", async () => {
    seedMerge({ id: "merge-bad-scope", runId: "run-bad-scope", packHash: "sha256:bad-scope" });
    db.prepare(
      `INSERT INTO federation_source_outcomes
        (id, tenant_id, federation_run_id, source_id, outcome, reason_code, policy_decision, policy_version, result_count, result_bytes, duration_ms, scope_hash)
       VALUES ('outcome-bad', 'tenant-a', 'run-bad-scope', 'source-1', 'success', 'ok', 'allow', 'federation-v1', 1, 64, 1, 'sha256:other')`,
    ).run();
    db.prepare(`UPDATE federation_merges SET contributing_outcome_ids = ? WHERE id = ?`).run(
      '["outcome-bad"]',
      "merge-bad-scope",
    );
    const { persistFederationActionArtifact } = await import("../action-bridge");
    expect(
      persistFederationActionArtifact(db, {
        ...baseInput,
        federationRunId: "run-bad-scope",
        packHash: "sha256:bad-scope",
      }).reason,
    ).toBe("federation_outcome_or_source_unavailable");
  });

  it("resolveFederationActionProof unavailable when source trust is disabled", async () => {
    const { persistFederationActionArtifact, resolveFederationActionProof } = await import("../action-bridge");
    const created = persistFederationActionArtifact(db, baseInput);
    expect(created.status).toBe("ready");
    if (created.status !== "ready") return;
    db.prepare(`UPDATE federation_sources SET enabled = 0 WHERE id = 'source-1'`).run();
    expect(
      resolveFederationActionProof(db, {
        tenantId: "tenant-a",
        spaceId: "space-a",
        artifactId: created.artifact.id,
      }).reason,
    ).toBe("federation_source_unavailable");
  });
});
