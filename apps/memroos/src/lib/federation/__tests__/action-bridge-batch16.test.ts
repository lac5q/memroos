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
  }> = {},
) {
  const id = overrides.id ?? "merge-1";
  const runId = overrides.runId ?? "federation-run-1";
  const packHash = overrides.packHash ?? "sha256:pack";
  db.prepare(
    `INSERT INTO federation_merges
      (id, tenant_id, federation_run_id, pack_hash, pack_bytes, pack_item_count, contributing_source_ids, contributing_outcome_ids, dedupe_metadata_json, rank_metadata_json, budget_metadata_json, bound_status, scope_hash)
     VALUES (?, 'tenant-a', ?, ?, ?, ?, ?, ?, '{}', '{}', '{}', ?, 'sha256:scope')`,
  ).run(
    id,
    runId,
    packHash,
    overrides.packBytes ?? 64,
    overrides.packItemCount ?? 1,
    overrides.sourceIds ?? '["source-1"]',
    overrides.outcomeIds ?? '["outcome-1"]',
    overrides.boundStatus ?? "bounded",
  );
  db.prepare(
    `INSERT INTO federation_merged_coordinates
      (id, tenant_id, federation_run_id, pack_hash, canonical_id, canonical_hash, source_id)
     VALUES (?, 'tenant-a', ?, ?, 'canonical-42', 'sha256:canonical-42', 'source-1')`,
  ).run(`coordinate-${id}`, runId, packHash);
}

beforeEach(async () => {
  testDbDir = path.join(os.tmpdir(), `federation-b16-${crypto.randomUUID()}`);
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

describe("federation action-bridge batch16 — denial and invalidation paths", () => {
  it("validateInput denies missing tenant/space and empty pack constraints", async () => {
    const { persistFederationActionArtifact } = await import("../action-bridge");
    expect(persistFederationActionArtifact(db, { ...baseInput, tenantId: " " }).reason).toBe("scope_unavailable");
    expect(persistFederationActionArtifact(db, { ...baseInput, federationRunId: "" }).reason).toBe(
      "federation_receipt_missing",
    );

    seedMerge({ id: "merge-empty", runId: "run-empty", packHash: "sha256:empty", packBytes: 0, packItemCount: 0 });
    expect(
      persistFederationActionArtifact(db, {
        ...baseInput,
        federationRunId: "run-empty",
        packHash: "sha256:empty",
      }).reason,
    ).toBe("federation_pack_empty");

    seedMerge({ id: "merge-unbounded", runId: "run-unbounded", packHash: "sha256:unbounded", boundStatus: "over_budget" });
    expect(
      persistFederationActionArtifact(db, {
        ...baseInput,
        federationRunId: "run-unbounded",
        packHash: "sha256:unbounded",
      }).reason,
    ).toBe("federation_pack_unbounded");
  });

  it("resolveFederationActionProof fails when ontology refs are empty or invalid", async () => {
    const { persistFederationActionArtifact, resolveFederationActionProof } = await import("../action-bridge");
    const created = persistFederationActionArtifact(db, baseInput);
    expect(created.status).toBe("ready");
    if (created.status !== "ready") return;

    db.prepare(`UPDATE federation_action_artifacts SET ontology_refs_json = '[]' WHERE id = ?`).run(created.artifact.id);
    expect(
      resolveFederationActionProof(db, {
        tenantId: "tenant-a",
        spaceId: "space-a",
        artifactId: created.artifact.id,
      }).reason,
    ).toBe("ontology_context_unavailable");
  });

  it("invalidateFederationArtifactsForCanonical marks derivatives and artifacts inactive", async () => {
    const {
      persistFederationActionArtifact,
      invalidateFederationArtifactsForCanonical,
    } = await import("../action-bridge");
    const created = persistFederationActionArtifact(db, baseInput);
    expect(created.status).toBe("ready");
    if (created.status !== "ready") return;

    const erasureId = `erasure_${crypto.randomUUID()}`;
    const result = invalidateFederationArtifactsForCanonical(db, {
      tenantId: "tenant-a",
      canonicalId: "canonical-42",
      erasureId,
    });
    expect(result.invalidated).toBeGreaterThanOrEqual(1);
    const row = db
      .prepare(`SELECT status FROM federation_action_artifacts WHERE id = ?`)
      .get(created.artifact.id) as { status: string };
    expect(row.status).toBe("invalidated");
  });
});
