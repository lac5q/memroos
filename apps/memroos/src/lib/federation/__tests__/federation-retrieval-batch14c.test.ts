// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeFederationRun, type FederationSourceClient } from "../retrieval";
import { registerFederationSource } from "../source-registry";
import { ensureCanonicalUpperOntology } from "@/lib/ontology/registry";

let db: import("better-sqlite3").Database;
let closeDb: () => void;
let TEST_DB_DIR: string;

beforeEach(async () => {
  TEST_DB_DIR = path.join(os.tmpdir(), `federation-b14c-${crypto.randomUUID()}`);
  fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  process.env.SQLITE_DB_PATH = path.join(TEST_DB_DIR, "fed.db");
  vi.resetModules();
  const { getDb, closeDb: close } = await import("@/lib/db");
  const { initSchema } = await import("@/lib/db-schema");
  db = getDb();
  initSchema(db);
  const ontology = ensureCanonicalUpperOntology(db, "operator");
  seedOntologyContext("alpha", ontology);
  closeDb = close;
});

afterEach(() => {
  closeDb();
  fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
});

function ontologyReference(sourceHandle: string) {
  return {
    tenantId: "default-tenant",
    spaceId: "space-1",
    recordType: "federation_source",
    recordId: sourceHandle,
  };
}

function seedOntologyContext(
  sourceHandle: string,
  ontology: { ontologyId: string; version: string; contentHash: string },
) {
  const reference = ontologyReference(sourceHandle);
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

function makeSource() {
  const registered = registerFederationSource(db, {
    tenantId: "default-tenant",
    sourceHandle: "alpha",
    sourceKind: "memory",
    purpose: "memory_search",
    allowedOperations: ["search"],
    transport: "inproc",
    createdBy: "u",
    spaceId: "space-1",
    ontologyReference: ontologyReference("alpha"),
  });
  if (registered.kind !== "registered") throw new Error("setup failed");
  return registered.source;
}

function okContext() {
  return {
    actor: { id: "user-1", role: "agent", capability: "agent-1", tenantId: "default-tenant" },
    purpose: "memory_search" as const,
    label: { visibility: "internal", policy: "agent_visible" },
    beliefStage: "silver_candidate_claim",
    scopeHash: "sha256:scope",
  };
}

describe("federation retrieval batch14c — budget, policy, empty results", () => {
  it("records omitted sources when global source budget is already saturated", async () => {
    const ontology = ensureCanonicalUpperOntology(db, "operator");
    seedOntologyContext("beta-b14c", ontology);
    const alpha = makeSource();
    const beta = registerFederationSource(db, {
      tenantId: "default-tenant",
      sourceHandle: "beta-b14c",
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
        recordId: "beta-b14c",
      },
    });
    if (beta.kind !== "registered") throw new Error("beta setup failed");
    const client: FederationSourceClient = {
      fetch: vi.fn(async () => ({ kind: "ok", results: [{ id: "c1", content: "ok", scopeHash: "sha256:scope", canonicalHash: "sha256:1", score: 1, observedAt: new Date().toISOString() }] })),
    };
    const run = await executeFederationRun(db, {
      tenantId: "default-tenant",
      query: "hello",
      context: okContext(),
      budget: { sourceCount: 1, perSourceResultCount: 5, globalResultCount: 5, hops: 1, fanout: 1, maxBytes: 5000, maxCalls: 5, deadlineMs: 1000 },
      sources: [alpha, beta.source],
      client,
    });
    expect(run.kind).toBe("ok");
    if (run.kind !== "ok") return;
    expect(run.run.outcomes.some((o) => o.outcome === "omitted")).toBe(true);
    expect(client.fetch.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("maps policy-denied sources without calling the client", async () => {
    const source = makeSource();
    const fetch = vi.fn(async () => ({ kind: "ok" as const, results: [] }));
    const run = await executeFederationRun(db, {
      tenantId: "default-tenant",
      query: "hello",
      context: {
        ...okContext(),
        purpose: "memory_promotion",
      },
      budget: { sourceCount: 1, perSourceResultCount: 5, globalResultCount: 5, hops: 1, fanout: 1, maxBytes: 5000, maxCalls: 5, deadlineMs: 1000 },
      sources: [source],
      client: { fetch },
    });
    expect(run.kind).toBe("ok");
    if (run.kind !== "ok") return;
    expect(run.run.outcomes.some((o) => o.outcome === "denied")).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("records empty source outcomes when fetch returns no candidates", async () => {
    const source = makeSource();
    const run = await executeFederationRun(db, {
      tenantId: "default-tenant",
      query: "hello",
      context: okContext(),
      budget: { sourceCount: 1, perSourceResultCount: 5, globalResultCount: 5, hops: 1, fanout: 1, maxBytes: 5000, maxCalls: 5, deadlineMs: 1000 },
      sources: [source],
      client: { fetch: async () => ({ kind: "ok", results: [] }) },
    });
    expect(run.kind).toBe("ok");
    if (run.kind !== "ok") return;
    expect(run.run.outcomes.some((o) => o.outcome === "empty" && o.reasonCode === "no_results")).toBe(true);
  });
});
