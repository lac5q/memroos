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
    packItemCount: number;
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
     VALUES (?, 'tenant-a', ?, ?, 64, ?, ?, ?, '{}', '{}', '{}', 'bounded', ?)`,
  ).run(
    id,
    runId,
    packHash,
    overrides.packItemCount ?? 1,
    overrides.sourceIds ?? '["source-1"]',
    overrides.outcomeIds ?? '["outcome-1"]',
    overrides.scopeHash ?? "sha256:scope",
  );
}

beforeEach(async () => {
  testDbDir = path.join(os.tmpdir(), `federation-b22c-${crypto.randomUUID()}`);
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

describe("federation action-bridge batch22c", () => {
  it("denies when coordinate ledger rows are blank", async () => {
    const { persistFederationActionArtifact } = await import("../action-bridge");
    db.prepare(`DELETE FROM federation_merged_coordinates`).run();
    db.prepare(
      `INSERT INTO federation_merged_coordinates
        (id, tenant_id, federation_run_id, pack_hash, canonical_id, canonical_hash, source_id)
       VALUES ('bad-coord', 'tenant-a', 'federation-run-1', 'sha256:pack', ' ', 'sha256:canonical-42', 'source-1')`,
    ).run();
    expect(
      persistFederationActionArtifact(db, baseInput).reason,
    ).toBe("federation_coordinate_ledger_unavailable");
  });

  it("is unavailable when outcome ids are empty or missing", async () => {
    const { persistFederationActionArtifact } = await import("../action-bridge");
    seedMerge({
      id: "merge-empty-outcomes",
      runId: "run-empty",
      packHash: "sha256:empty-outcomes",
      outcomeIds: "[]",
    });
    db.prepare(
      `INSERT INTO federation_merged_coordinates
        (id, tenant_id, federation_run_id, pack_hash, canonical_id, canonical_hash, source_id)
       VALUES ('coordinate-empty', 'tenant-a', 'run-empty', 'sha256:empty-outcomes', 'canonical-42', 'sha256:canonical-42', 'source-1')`,
    ).run();
    expect(
      persistFederationActionArtifact(db, {
        ...baseInput,
        federationRunId: "run-empty",
        packHash: "sha256:empty-outcomes",
      }).reason,
    ).toBe("federation_outcome_or_source_unavailable");

    seedMerge({
      id: "merge-missing-outcome",
      runId: "run-missing-outcome",
      packHash: "sha256:missing-outcome",
      outcomeIds: '["missing-outcome-id"]',
    });
    db.prepare(
      `INSERT INTO federation_merged_coordinates
        (id, tenant_id, federation_run_id, pack_hash, canonical_id, canonical_hash, source_id)
       VALUES ('coordinate-missing', 'tenant-a', 'run-missing-outcome', 'sha256:missing-outcome', 'canonical-42', 'sha256:canonical-42', 'source-1')`,
    ).run();
    expect(
      persistFederationActionArtifact(db, {
        ...baseInput,
        federationRunId: "run-missing-outcome",
        packHash: "sha256:missing-outcome",
      }).reason,
    ).toBe("federation_outcome_or_source_unavailable");
  });

  it("returns ready for existing artifacts and denies ledger drift", async () => {
    const { persistFederationActionArtifact } = await import("../action-bridge");
    const created = persistFederationActionArtifact(db, baseInput);
    expect(created.status).toBe("ready");
    if (created.status !== "ready") return;

    const again = persistFederationActionArtifact(db, baseInput);
    expect(again.status).toBe("ready");

    db.prepare(`UPDATE federation_action_derivatives SET status = 'invalidated' WHERE artifact_id = ?`).run(
      created.artifact.id,
    );
    const mismatch = persistFederationActionArtifact(db, baseInput);
    expect(mismatch.status).toBe("denied");
    expect(mismatch.reason).toBe("federation_artifact_mismatch");
  });
});
