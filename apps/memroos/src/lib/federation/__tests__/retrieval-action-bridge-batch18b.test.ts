// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureCanonicalUpperOntology } from "@/lib/ontology/registry";
import { executeFederationRun, type FederationSourceClient } from "../retrieval";
import { registerFederationSource } from "../source-registry";

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
  federationRunId: "federation-run-b18b",
  packHash: "sha256:pack-b18b",
  ontologyRecords: [{ recordType: "message", recordId: "42" }],
};

function seedMerge() {
  db.prepare(
    `INSERT INTO federation_merges
      (id, tenant_id, federation_run_id, pack_hash, pack_bytes, pack_item_count, contributing_source_ids, contributing_outcome_ids, dedupe_metadata_json, rank_metadata_json, budget_metadata_json, bound_status, scope_hash)
     VALUES ('merge-b18b', 'tenant-a', 'federation-run-b18b', 'sha256:pack-b18b', 64, 1, '["source-1"]', '["outcome-1"]', '{}', '{}', '{}', 'bounded', 'sha256:scope')`,
  ).run();
  db.prepare(
    `INSERT INTO federation_merged_coordinates
      (id, tenant_id, federation_run_id, pack_hash, canonical_id, canonical_hash, source_id)
     VALUES ('coordinate-b18b', 'tenant-a', 'federation-run-b18b', 'sha256:pack-b18b', 'canonical-42', 'sha256:canonical-42', 'source-1')`,
  ).run();
}

beforeEach(async () => {
  testDbDir = path.join(os.tmpdir(), `federation-b18b-${crypto.randomUUID()}`);
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
     VALUES ('outcome-1', 'tenant-a', 'federation-run-b18b', 'source-1', 'success', 'ok', 'allow', 'federation-v1', 1, 64, 1, 'sha256:scope')`,
  ).run();
  seedMerge();
});

afterEach(() => {
  closeDb();
  fs.rmSync(testDbDir, { recursive: true, force: true });
});

describe("federation batch18b — action bridge + retrieval", () => {
  it("resolveFederationActionProof unavailable when artifact id is unknown", async () => {
    const { resolveFederationActionProof } = await import("../action-bridge");
    expect(
      resolveFederationActionProof(db, {
        tenantId: "tenant-a",
        spaceId: "space-a",
        artifactId: "missing-artifact",
      }    ).reason,
    ).toBe("federation_artifact_unavailable");
  });

  it("executeFederationRun rejects invalid budget configuration", async () => {
    const ontology = ensureCanonicalUpperOntology(db, "operator");
    const registered = registerFederationSource(db, {
      tenantId: "default-tenant",
      sourceHandle: "alpha-b18b",
      sourceKind: "memory",
      purpose: "memory_search",
      allowedOperations: ["search"],
      transport: "inproc",
      createdBy: "u",
      spaceId: "space-1",
      ontologyReference: {
        tenantId: "default-tenant",
        spaceId: "space-1",
        recordType: "federation_source",
        recordId: "alpha-b18b",
      },
    });
    if (registered.kind !== "registered") throw new Error("setup");
    void ontology;
    const client: FederationSourceClient = {
      fetch: async () => ({ kind: "ok", results: [] }),
    };
    const rejected = await executeFederationRun(db, {
      tenantId: "default-tenant",
      query: "hello",
      context: {
        actor: { id: "user-1", role: "agent", capability: "agent-1", tenantId: "default-tenant" },
        purpose: "memory_search",
        beliefStage: "gold_claim",
        label: { visibility: "internal", policy: "agent_visible" },
      },
      budget: { sourceCount: 0 },
      sources: [registered.source],
      client,
    });
    expect(rejected.kind).toBe("budget_rejected");
  });

  it("persistFederationActionArtifact ready for seeded merge", async () => {
    const { persistFederationActionArtifact } = await import("../action-bridge");
    const created = persistFederationActionArtifact(db, baseInput);
    expect(created.status).toBe("ready");
  });
});
