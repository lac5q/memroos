// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ontology/validity", () => ({
  resolveOntologyValidity: vi.fn((_db, input) => {
    if (input.recordId === "throw-b19") {
      throw new Error("ontology resolver fault b19");
    }
    return {
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
    };
  }),
}));

let db: import("better-sqlite3").Database;
let closeDb: () => void;
let testDbDir: string;

const baseInput = {
  tenantId: "tenant-a",
  spaceId: "space-a",
  federationRunId: "federation-run-b19",
  packHash: "sha256:pack-b19",
  ontologyRecords: [{ recordType: "message", recordId: "42" }],
};

function seedMerge(overrides: Partial<{ outcomeIds: string; sourceIds: string }> = {}) {
  db.prepare(
    `INSERT INTO federation_merges
      (id, tenant_id, federation_run_id, pack_hash, pack_bytes, pack_item_count, contributing_source_ids, contributing_outcome_ids, dedupe_metadata_json, rank_metadata_json, budget_metadata_json, bound_status, scope_hash)
     VALUES ('merge-b19', 'tenant-a', 'federation-run-b19', 'sha256:pack-b19', 64, 1, ?, ?, '{}', '{}', '{}', 'bounded', 'sha256:scope')`,
  ).run(
    overrides.sourceIds ?? '["source-1"]',
    overrides.outcomeIds ?? '["outcome-1"]',
  );
  db.prepare(
    `INSERT INTO federation_merged_coordinates
      (id, tenant_id, federation_run_id, pack_hash, canonical_id, canonical_hash, source_id)
     VALUES ('coordinate-b19', 'tenant-a', 'federation-run-b19', 'sha256:pack-b19', 'canonical-42', 'sha256:canonical-42', 'source-1')`,
  ).run();
}

beforeEach(async () => {
  testDbDir = path.join(os.tmpdir(), `federation-b19-${crypto.randomUUID()}`);
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
     VALUES ('source-1', 'tenant-a', 'memory-a', 'memory', 'space-a', 'orchestration', '["search"]', 'trusted', 1, 0, 'local', '{}', 'sha256:registration', 'operator'),
            ('source-2', 'tenant-a', 'memory-b', 'memory', 'space-a', 'orchestration', '["search"]', 'trusted', 1, 0, 'local', '{}', 'sha256:registration-2', 'operator')`,
  ).run();
  db.prepare(
    `INSERT INTO federation_source_outcomes
      (id, tenant_id, federation_run_id, source_id, outcome, reason_code, policy_decision, policy_version, result_count, result_bytes, duration_ms, scope_hash)
     VALUES ('outcome-1', 'tenant-a', 'federation-run-b19', 'source-1', 'success', 'ok', 'allow', 'federation-v1', 1, 64, 1, 'sha256:scope')`,
  ).run();
  seedMerge();
});

afterEach(() => {
  closeDb();
  fs.rmSync(testDbDir, { recursive: true, force: true });
});

describe("federation action-bridge + budgets batch19", () => {
  it("persistFederationActionArtifact unavailable when coordinate query throws", async () => {
    const { persistFederationActionArtifact } = await import("../action-bridge");
    const throwingDb = {
      prepare(sql: string) {
        const stmt = db.prepare(sql);
        if (sql.includes("federation_merged_coordinates")) {
          return {
            all: () => {
              throw new Error("coordinates unreadable b19");
            },
            get: (...args: unknown[]) => stmt.get(...args),
            run: (...args: unknown[]) => stmt.run(...args),
          };
        }
        return stmt;
      },
    } as unknown as typeof db;
    expect(
      persistFederationActionArtifact(throwingDb, baseInput).reason,
    ).toBe("federation_coordinate_ledger_unavailable");
  });

  it("persistFederationActionArtifact unavailable when outcome source set mismatches merge", async () => {
    db.prepare(`DELETE FROM federation_merged_coordinates WHERE federation_run_id = 'federation-run-b19'`).run();
    db.prepare(`DELETE FROM federation_merges WHERE id = 'merge-b19'`).run();
    seedMerge({ sourceIds: '["source-1", "source-2"]', outcomeIds: '["outcome-1"]' });
    const { persistFederationActionArtifact } = await import("../action-bridge");
    expect(
      persistFederationActionArtifact(db, baseInput).reason,
    ).toBe("federation_outcome_or_source_unavailable");
  });

  it("persistFederationActionArtifact unavailable when ontology resolution throws", async () => {
    const { persistFederationActionArtifact } = await import("../action-bridge");
    expect(
      persistFederationActionArtifact(db, {
        ...baseInput,
        ontologyRecords: [{ recordType: "message", recordId: "throw-b19" }],
      }).reason,
    ).toBe("ontology_context_unavailable");
  });

  it("persistFederationActionArtifact denies when an existing artifact hash mismatches", async () => {
    const { persistFederationActionArtifact } = await import("../action-bridge");
    const created = persistFederationActionArtifact(db, baseInput);
    expect(created.status).toBe("ready");
    if (created.status !== "ready") return;
    db.prepare(`UPDATE federation_action_artifacts SET space_id = 'space-other-b19' WHERE id = ?`).run(
      created.artifact.id,
    );
    const mismatch = persistFederationActionArtifact(db, baseInput);
    expect(mismatch.status).toBe("denied");
    if (mismatch.status === "denied") {
      expect(mismatch.reason).toBe("federation_artifact_mismatch");
    }
  });
});

describe("federation budgets batch19", () => {
  it("BudgetTracker enforces global call and result count ceilings", async () => {
    const { BudgetTracker } = await import("../budgets");
    const tight = {
      sourceCount: 3,
      perSourceResultCount: 5,
      globalResultCount: 1,
      hops: 1,
      fanout: 3,
      maxBytes: 10_000,
      maxCalls: 1,
      deadlineMs: 60_000,
    };
    const tracker = new BudgetTracker(tight);
    expect(tracker.startSource("source-a").ok).toBe(true);
    const secondCall = tracker.startSource("source-b");
    expect(secondCall.ok).toBe(false);
    if (!secondCall.ok) expect(secondCall.reason).toBe("global_call_count_exceeded");

    const resultsTracker = new BudgetTracker({ ...tight, maxCalls: 5 });
    resultsTracker.startSource("source-a");
    expect(resultsTracker.recordResult("source-a", 10).ok).toBe(true);
    const secondResult = resultsTracker.recordResult("source-a", 10);
    expect(secondResult.ok).toBe(false);
    if (!secondResult.ok) expect(secondResult.reason).toBe("global_result_count_exceeded");
  });
});
