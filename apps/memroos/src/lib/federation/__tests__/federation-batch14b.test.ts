// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

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

beforeEach(async () => {
  testDbDir = path.join(os.tmpdir(), `federation-b14b-${crypto.randomUUID()}`);
  fs.mkdirSync(testDbDir, { recursive: true });
  process.env.SQLITE_DB_PATH = path.join(testDbDir, "federation.db");
  vi.resetModules();
  const { getDb, closeDb: close } = await import("@/lib/db");
  const { initSchema } = await import("@/lib/db-schema");
  db = getDb();
  initSchema(db);
  closeDb = close;
  db.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-a', 'Tenant A')").run();
});

afterEach(() => {
  closeDb();
  fs.rmSync(testDbDir, { recursive: true, force: true });
});

describe("federation batch14b — action-bridge parse failures and retrieval edges", () => {
  it("persistFederationActionArtifact denies malformed contributing id JSON", async () => {
    const { persistFederationActionArtifact } = await import("../action-bridge");
    db.prepare(
      `INSERT INTO federation_merges
        (id, tenant_id, federation_run_id, pack_hash, pack_bytes, pack_item_count, contributing_source_ids, contributing_outcome_ids, dedupe_metadata_json, rank_metadata_json, budget_metadata_json, bound_status, scope_hash)
       VALUES ('merge-bad', 'tenant-a', 'run-bad', 'sha256:pack-bad', 1, 1, 'not-json', '[]', '{}', '{}', '{}', 'bounded', 'sha256:scope')`,
    ).run();
    const result = persistFederationActionArtifact(db, {
      tenantId: "tenant-a",
      spaceId: "space-a",
      federationRunId: "run-bad",
      packHash: "sha256:pack-bad",
      ontologyRecords: [{ recordType: "message", recordId: "1" }],
    });
    expect(result.status).not.toBe("ready");
  });

  it("persistFederationActionArtifact denies when coordinate ledger count mismatches", async () => {
    const { persistFederationActionArtifact } = await import("../action-bridge");
    db.prepare("DELETE FROM federation_merged_coordinates").run();
    const result = persistFederationActionArtifact(db, {
      tenantId: "tenant-a",
      spaceId: "space-a",
      federationRunId: "federation-run-1",
      packHash: "sha256:pack",
      ontologyRecords: [{ recordType: "message", recordId: "42" }],
    });
    expect(result.status).toBe("unavailable");
    expect(["federation_coordinate_ledger_unavailable", "federation_merge_unavailable"]).toContain(
      result.reason,
    );
  });
});
