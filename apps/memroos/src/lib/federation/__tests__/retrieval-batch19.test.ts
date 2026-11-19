// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureCanonicalUpperOntology } from "@/lib/ontology/registry";
import { registerFederationSource } from "../source-registry";
import { executeFederationRun, type FederationSourceClient } from "../retrieval";

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

function okBudget() {
  return {
    sourceCount: 5,
    perSourceResultCount: 5,
    globalResultCount: 20,
    hops: 1,
    fanout: 5,
    maxBytes: 5000,
    maxCalls: 5,
    deadlineMs: 1000,
  };
}

function okContext() {
  return {
    actor: { id: "user-1", role: "agent" as const, capability: "agent-1", tenantId: "default-tenant" },
    purpose: "memory_search" as const,
    label: { visibility: "internal" as const, policy: "agent_visible" as const },
    beliefStage: "silver_candidate_claim",
    scopeHash: "sha256:scope-b19",
  };
}

function seedOntologyContext(sourceHandle: string, ontology: { ontologyId: string; version: string; contentHash: string }) {
  const reference = {
    tenantId: "default-tenant",
    spaceId: "space-1",
    recordType: "federation_source",
    recordId: sourceHandle,
  };
  const sourceId = `source:${sourceHandle}`;
  const sourceHash = `sha256:${sourceHandle.padEnd(64, "a").slice(0, 64)}`;
  const derivativeId = `record:${sourceHandle}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO ontology_versioned_records
      (id, tenant_id, space_id, record_type, record_id, qualified_type, ontology_id, ontology_version,
       ontology_content_hash, mapping_path_json, created_at, source_id, source_hash)
     VALUES (?, ?, ?, ?, ?, 'memory', ?, ?, ?, '[]', ?, ?, ?)`,
  ).run(
    derivativeId,
    reference.tenantId,
    reference.spaceId,
    reference.recordType,
    reference.recordId,
    ontology.ontologyId,
    ontology.version,
    ontology.contentHash,
    now,
    sourceId,
    sourceHash,
  );
  db.prepare(
    `INSERT INTO ontology_source_lifecycle
      (tenant_id, space_id, source_id, source_hash, status, updated_at, updated_by, reason_code)
     VALUES (?, ?, ?, ?, 'active', ?, 'operator', 'test')`,
  ).run(reference.tenantId, reference.spaceId, sourceId, sourceHash, now);
  db.prepare(
    `INSERT INTO ontology_derivative_validity
      (id, tenant_id, space_id, source_id, source_hash, derivative_type, derivative_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'versioned_record', ?, 'authoritative', ?)`,
  ).run(`valid:${derivativeId}`, reference.tenantId, reference.spaceId, sourceId, sourceHash, derivativeId, now);
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
  db.prepare("INSERT OR IGNORE INTO tenants (id, name) VALUES ('default-tenant', 'Tenant')").run();
  const ontology = ensureCanonicalUpperOntology(db, "operator");
  seedOntologyContext("timeout-src", ontology);
  seedOntologyContext("throws-src", ontology);
  seedOntologyContext("onto-missing-b19", ontology);
});

afterEach(() => {
  closeDb();
  fs.rmSync(testDbDir, { recursive: true, force: true });
});

describe("federation retrieval batch19 — client outcomes and policy branches", () => {
  it("records timeout and malformed client outcomes", async () => {
    const registered = registerFederationSource(db, {
      tenantId: "default-tenant",
      sourceHandle: "timeout-src",
      sourceKind: "memory",
      purpose: "memory_search",
      allowedOperations: ["search"],
      transport: "inproc",
      createdBy: "operator",
      spaceId: "space-1",
      ontologyReference: {
        tenantId: "default-tenant",
        spaceId: "space-1",
        recordType: "federation_source",
        recordId: "timeout-src",
      },
    });
    if (registered.kind !== "registered") throw new Error("setup");
    const timeoutClient: FederationSourceClient = {
      fetch: async () => ({ kind: "timeout", reason: "upstream_slow" }),
    };
    const timeoutRun = await executeFederationRun(db, {
      tenantId: "default-tenant",
      query: "hello",
      context: okContext(),
      budget: okBudget(),
      sources: [registered.source],
      client: timeoutClient,
    });
    expect(timeoutRun.kind).toBe("ok");
    if (timeoutRun.kind === "ok") {
      expect(timeoutRun.run.outcomes[0]?.outcome).toBe("timeout");
    }

    const malformedClient: FederationSourceClient = {
      fetch: async () => ({ kind: "malformed", reason: "bad_payload" }),
    };
    const malformedRun = await executeFederationRun(db, {
      tenantId: "default-tenant",
      query: "hello",
      context: okContext(),
      budget: okBudget(),
      sources: [registered.source],
      client: malformedClient,
    });
    expect(malformedRun.kind === "ok" && malformedRun.run.outcomes[0]?.outcome).toBe("malformed");
  });

  it("maps thrown client fetch errors to failed outcomes", async () => {
    const registered = registerFederationSource(db, {
      tenantId: "default-tenant",
      sourceHandle: "throws-src",
      sourceKind: "memory",
      purpose: "memory_search",
      allowedOperations: ["search"],
      transport: "inproc",
      createdBy: "operator",
      spaceId: "space-1",
      ontologyReference: {
        tenantId: "default-tenant",
        spaceId: "space-1",
        recordType: "federation_source",
        recordId: "throws-src",
      },
    });
    if (registered.kind !== "registered") throw new Error("setup");
    const client: FederationSourceClient = {
      fetch: async () => {
        throw new Error("client exploded");
      },
    };
    const run = await executeFederationRun(db, {
      tenantId: "default-tenant",
      query: "hello",
      context: okContext(),
      budget: okBudget(),
      sources: [registered.source],
      client,
    });
    expect(run.kind === "ok" && run.run.outcomes[0]?.outcome).toBe("failed");
  });

  it("denies sources whose ontology context cannot be resolved", async () => {
    const registered = registerFederationSource(db, {
      tenantId: "default-tenant",
      sourceHandle: "onto-missing-b19",
      sourceKind: "memory",
      purpose: "memory_search",
      allowedOperations: ["search"],
      transport: "inproc",
      createdBy: "operator",
      spaceId: "space-1",
      ontologyReference: {
        tenantId: "default-tenant",
        spaceId: "space-1",
        recordType: "federation_source",
        recordId: "onto-missing-b19",
      },
    });
    if (registered.kind !== "registered") throw new Error("setup");
    const validity = await import("@/lib/ontology/validity");
    vi.mocked(validity.resolveOntologyValidity).mockImplementationOnce(() => {
      throw new Error("ontology stale");
    });
    const run = await executeFederationRun(db, {
      tenantId: "default-tenant",
      query: "hello",
      context: okContext(),
      budget: okBudget(),
      sources: [registered.source],
      client: { fetch: async () => ({ kind: "ok", results: [] }) },
    });
    expect(run.kind === "ok" && run.run.outcomes[0]?.reasonCode).toBe("ontology_context_unavailable");
  });
});
