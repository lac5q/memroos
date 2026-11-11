// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { OntologyGovernanceError } from "../candidates";
import {
  registerOntologyDerivative,
  registerOntologySource,
  revokeOntologyDerivativesForErasedRecord,
  sourceForCanonicalDefinition,
} from "../validity";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("ontology validity long-tail", () => {
  const coords = {
    tenantId: "default-tenant",
    spaceId: "validity-space",
    sourceId: "src_validity_1",
    sourceHash: `sha256:${"b".repeat(64)}`,
  };

  it("registerOntologyDerivative requires an active source lifecycle row", () => {
    const database = freshDb();
    expect(() =>
      registerOntologyDerivative(database, {
        ...coords,
        derivativeType: "candidate",
        derivativeId: "cand-1",
      })
    ).toThrow(OntologyGovernanceError);

    registerOntologySource(database, { ...coords, actor: "operator" });
    registerOntologyDerivative(database, {
      ...coords,
      derivativeType: "candidate",
      derivativeId: "cand-1",
    });
    const row = database
      .prepare(
        `SELECT status FROM ontology_derivative_validity WHERE derivative_type = 'candidate' AND derivative_id = ?`
      )
      .get("cand-1") as { status: string };
    expect(row.status).toBe("authoritative");
  });

  it("revokeOntologyDerivativesForErasedRecord revokes versioned_record rows", () => {
    const database = freshDb();
    registerOntologySource(database, { ...coords, actor: "operator" });
    const recordId = "msg-erased-1";
    database
      .prepare(
        `INSERT INTO ontology_versioned_records
          (id, tenant_id, space_id, record_type, record_id, qualified_type, ontology_id,
           ontology_version, ontology_content_hash, legacy_type, mapping_path_json, created_at,
           source_id, source_hash)
         VALUES (?, ?, ?, 'message', ?, 'memory.claim', 'memroos.core', '1.0.0', ?, 'legacy', '[]', ?, ?, ?)`
      )
      .run(
        "vr-1",
        coords.tenantId,
        coords.spaceId,
        recordId,
        `sha256:${"c".repeat(64)}`,
        new Date().toISOString(),
        coords.sourceId,
        coords.sourceHash
      );
    registerOntologyDerivative(database, {
      ...coords,
      derivativeType: "versioned_record",
      derivativeId: "vr-1",
    });

    const revoked = revokeOntologyDerivativesForErasedRecord(database, {
      tenantId: coords.tenantId,
      recordType: "message",
      recordId,
      actor: "operator",
    });
    expect(revoked).toBe(1);
    expect(
      database
        .prepare(`SELECT status FROM ontology_derivative_validity WHERE derivative_id = 'vr-1'`)
        .get()
    ).toMatchObject({ status: "revoked" });
  });

  it("sourceForCanonicalDefinition returns null when definition chain is missing", () => {
    const database = freshDb();
    expect(
      sourceForCanonicalDefinition(database, {
        ontologyId: "memroos.core",
        ontologyVersion: "1.0.0",
        namespace: "finance",
        canonicalId: "finance.invoice",
      })
    ).toBeNull();
  });
});
