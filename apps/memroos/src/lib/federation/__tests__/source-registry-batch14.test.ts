// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureCanonicalUpperOntology } from "@/lib/ontology/registry";
import {
  getFederationSource,
  listFederationSources,
  registerFederationSource,
  resolveFederationSourceOntologyContext,
} from "../source-registry";

let db: import("better-sqlite3").Database;
let closeDb: () => void;
let TEST_DB_DIR: string;

function seedOntologyContext(
  target: import("better-sqlite3").Database,
  ontology: { ontologyId: string; version: string; contentHash: string },
  reference: { tenantId: string; spaceId: string; recordType: string; recordId: string },
) {
  const sourceId = `source:${reference.recordType}:${reference.recordId}`;
  const sourceHash = `sha256:${"f".repeat(64)}`;
  const derivativeId = `record:${reference.recordType}:${reference.recordId}`;
  const now = new Date().toISOString();
  target.prepare(
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
  target.prepare(
    `INSERT INTO ontology_source_lifecycle
      (tenant_id, space_id, source_id, source_hash, status, updated_at, updated_by, reason_code)
     VALUES (?, ?, ?, ?, 'active', ?, 'operator', 'test')`,
  ).run(reference.tenantId, reference.spaceId, sourceId, sourceHash, now);
  target.prepare(
    `INSERT INTO ontology_derivative_validity
      (id, tenant_id, space_id, source_id, source_hash, derivative_type, derivative_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'versioned_record', ?, 'authoritative', ?)`,
  ).run(`valid:${derivativeId}`, reference.tenantId, reference.spaceId, sourceId, sourceHash, derivativeId, now);
}

beforeEach(async () => {
  TEST_DB_DIR = path.join(os.tmpdir(), `fed-b14-${crypto.randomUUID()}`);
  fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  process.env.SQLITE_DB_PATH = path.join(TEST_DB_DIR, "fed.db");
  vi.resetModules();
  const { getDb, closeDb: close } = await import("@/lib/db");
  const { initSchema } = await import("@/lib/db-schema");
  db = getDb();
  initSchema(db);
  closeDb = close;
});

afterEach(() => {
  closeDb();
  fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
});

describe("source-registry batch14 — row parsing and ontology revalidation", () => {
  it("getFederationSource returns null for unknown ids", () => {
    expect(getFederationSource(db, "default-tenant", "missing")).toBeNull();
  });

  it("listFederationSources filters by kind and enabled flag", () => {
    const ontology = ensureCanonicalUpperOntology(db, "operator");
    const reference = {
      tenantId: "default-tenant",
      spaceId: "space-1",
      recordType: "federation_source",
      recordId: "mem-src",
    };
    seedOntologyContext(db, ontology, reference);
    registerFederationSource(db, {
      tenantId: "default-tenant",
      sourceHandle: "mem-src",
      sourceKind: "memory",
      spaceId: "space-1",
      purpose: "memory_search",
      allowedOperations: ["search"],
      transport: "inproc",
      createdBy: "operator",
      ontologyReference: reference,
      enabled: false,
    });
    expect(listFederationSources(db, "default-tenant", { enabledOnly: true })).toHaveLength(0);
    expect(listFederationSources(db, "default-tenant", { sourceKind: "memory" })).toHaveLength(1);
  });

  it("resolveFederationSourceOntologyContext returns null when persisted coordinates drift", () => {
    const ontology = ensureCanonicalUpperOntology(db, "operator");
    const reference = {
      tenantId: "default-tenant",
      spaceId: "space-1",
      recordType: "federation_source",
      recordId: "drift-src",
    };
    seedOntologyContext(db, ontology, reference);
    const registered = registerFederationSource(db, {
      tenantId: "default-tenant",
      sourceHandle: "drift-src",
      sourceKind: "memory",
      spaceId: "space-1",
      purpose: "memory_search",
      allowedOperations: ["search"],
      transport: "inproc",
      createdBy: "operator",
      ontologyReference: reference,
    });
    if (registered.kind !== "registered") throw new Error("register failed");
    db.prepare(`UPDATE federation_sources SET ontology_content_hash = ? WHERE id = ?`).run(
      `sha256:${"z".repeat(64)}`,
      registered.source.id,
    );
    const row = getFederationSource(db, "default-tenant", registered.source.id);
    if (!row) throw new Error("missing row");
    expect(resolveFederationSourceOntologyContext(db, row)).toBeNull();
  });
});
