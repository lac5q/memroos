// @vitest-environment node
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { ensureCanonicalUpperOntology } from "@/lib/ontology/registry";
import {
  getFederationSource,
  resolveFederationSourceOntologyContext,
  registerFederationSource,
} from "../source-registry";

function seedOntologyContext(
  target: Database.Database,
  ontology: { ontologyId: string; version: string; contentHash: string },
  reference: { tenantId: string; spaceId: string; recordType: string; recordId: string },
) {
  const sourceId = `source:${reference.recordType}:${reference.recordId}`;
  const sourceHash = `sha256:${"f".repeat(64)}`;
  const derivativeId = `record:${reference.recordType}:${reference.recordId}`;
  const now = new Date().toISOString();
  target
    .prepare(
      `INSERT INTO ontology_versioned_records
        (id, tenant_id, space_id, record_type, record_id, qualified_type, ontology_id, ontology_version,
         ontology_content_hash, mapping_path_json, created_at, source_id, source_hash)
       VALUES (?, ?, ?, ?, ?, 'memory', ?, ?, ?, '[]', ?, ?, ?)`,
    )
    .run(
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
  target
    .prepare(
      `INSERT INTO ontology_source_lifecycle
        (tenant_id, space_id, source_id, source_hash, status, updated_at, updated_by, reason_code)
       VALUES (?, ?, ?, ?, 'active', ?, 'operator', 'test')`,
    )
    .run(reference.tenantId, reference.spaceId, sourceId, sourceHash, now);
  target
    .prepare(
      `INSERT INTO ontology_derivative_validity
        (id, tenant_id, space_id, source_id, source_hash, derivative_type, derivative_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'versioned_record', ?, 'authoritative', ?)`,
    )
    .run(`valid:${derivativeId}`, reference.tenantId, reference.spaceId, sourceId, sourceHash, derivativeId, now);
}

describe("federation source-registry batch30", () => {
  it("parseSourceRow handles non-string JSON columns via safeRecord/safeArray (446, 457, 461)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    ensureCanonicalUpperOntology(db, "operator");
    const id = `fed-b30-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO federation_sources
        (id, tenant_id, source_handle, source_kind, purpose, label_policy_json, allowed_operations_json,
         trust_level, enabled, has_expiry, transport, descriptor_json, registration_hash,
         created_by, created_at, updated_at)
       VALUES (?, 'default-tenant', 'parse-b30', 'memory', 'purpose', 1, 2, 'registered', 1, 0, 'local', 3, 'hash-b30', 'operator', datetime('now'), datetime('now'))`,
    ).run(id);
    const row = getFederationSource(db, "default-tenant", id);
    expect(row?.labelPolicyJson).toEqual({});
    expect(row?.allowedOperations).toEqual([]);
    expect(row?.descriptor).toEqual({});
    db.close();
  });

  it("resolveFederationSourceOntologyContext returns null without spaceId or on drift (336)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const ontology = ensureCanonicalUpperOntology(db, "operator");
    const reference = {
      tenantId: "default-tenant",
      spaceId: "space-b30",
      recordType: "federation_source",
      recordId: "no-space-b30",
    };
    seedOntologyContext(db, ontology, reference);
    const registered = registerFederationSource(db, {
      tenantId: "default-tenant",
      sourceHandle: "no-space-b30",
      sourceKind: "memory",
      spaceId: "space-b30",
      purpose: "memory_search",
      allowedOperations: ["search"],
      transport: "inproc",
      createdBy: "operator",
      ontologyReference: reference,
    });
    if (registered.kind !== "registered") throw new Error("register failed");
    const withoutSpace = { ...registered.source, spaceId: null };
    expect(resolveFederationSourceOntologyContext(db, withoutSpace)).toBeNull();

    db.prepare(`UPDATE federation_sources SET ontology_content_hash = ? WHERE id = ?`).run(
      `sha256:${"b".repeat(64)}`,
      registered.source.id,
    );
    const drifted = getFederationSource(db, "default-tenant", registered.source.id)!;
    expect(resolveFederationSourceOntologyContext(db, drifted)).toBeNull();
    expect(ontology.ontologyId).toBeTruthy();
    db.close();
  });
});
