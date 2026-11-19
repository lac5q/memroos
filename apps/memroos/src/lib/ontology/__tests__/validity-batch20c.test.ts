// @vitest-environment node
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { OntologyGovernanceError } from "@/lib/ontology/candidates";
import {
  registerOntologyDerivative,
  registerOntologySource,
  resolveOntologyValidity,
  revokeOntologySource,
} from "@/lib/ontology/validity";

describe("ontology validity batch20c", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    db.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-b20c', 'Tenant')").run();
  });

  afterEach(() => {
    db.close();
  });

  it("resolveOntologyValidity throws unavailable when record is missing", () => {
    expect(() =>
      resolveOntologyValidity(db, {
        tenantId: "tenant-b20c",
        spaceId: "space-a",
        recordType: "knowledge",
        recordId: "missing",
      }),
    ).toThrow(OntologyGovernanceError);
  });

  it("resolveOntologyValidity throws when source lifecycle is revoked", () => {
    const recordId = `vr-${crypto.randomUUID().slice(0, 8)}`;
    const sourceId = "source:revoke-b20c";
    const sourceHash = `sha256:${"a".repeat(64)}`;
    db.prepare(
      `INSERT INTO ontology_versioned_records
        (id, tenant_id, space_id, record_type, record_id, qualified_type, ontology_id, ontology_version, ontology_content_hash, legacy_type, mapping_path_json, created_at, source_id, source_hash)
       VALUES (?, 'tenant-b20c', 'space-a', 'knowledge', 'rec-1', 'entity.thing', 'ont-1', '1.0.0', 'hash-1', 'legacy', '[]', ?, ?, ?)`,
    ).run(recordId, new Date().toISOString(), sourceId, sourceHash);
    registerOntologySource(db, {
      tenantId: "tenant-b20c",
      spaceId: "space-a",
      sourceId,
      sourceHash,
      actor: "operator",
    });
    registerOntologyDerivative(db, {
      tenantId: "tenant-b20c",
      spaceId: "space-a",
      sourceId,
      sourceHash,
      derivativeType: "versioned_record",
      derivativeId: recordId,
      actor: "operator",
    });
    revokeOntologySource(db, {
      tenantId: "tenant-b20c",
      spaceId: "space-a",
      sourceId,
      sourceHash,
      actor: "operator",
      reason: "source_changed",
    });
    expect(() =>
      resolveOntologyValidity(db, {
        tenantId: "tenant-b20c",
        spaceId: "space-a",
        recordType: "knowledge",
        recordId: "rec-1",
      }),
    ).toThrow(/revoked|unverified|unavailable/i);
  });
});
