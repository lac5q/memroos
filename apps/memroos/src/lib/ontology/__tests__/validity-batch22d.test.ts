// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { decideOntologyCandidate, extractOntologyCandidate } from "@/lib/ontology/candidates";
import { ensureCanonicalUpperOntology } from "@/lib/ontology/registry";
import {
  OntologyGovernanceError,
  assertCandidateAuthoritative,
  registerOntologyDerivative,
  registerOntologySource,
  resolveOntologyValidity,
} from "@/lib/ontology/validity";

describe("ontology validity batch22d — assertCurrentOntology and candidate authority", () => {
  let db: Database.Database;
  const sourceHash = `sha256:${"f".repeat(64)}`;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    db.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES ('default-tenant', 'Default')`).run();
    ensureCanonicalUpperOntology(db, "operator");
  });

  afterEach(() => {
    db.close();
  });

  it("resolveOntologyValidity rejects stale ontology content hashes", () => {
    registerOntologySource(db, {
      tenantId: "default-tenant",
      spaceId: "space-a",
      sourceId: "src-b22d",
      sourceHash,
      actor: "operator",
    });
    registerOntologyDerivative(db, {
      tenantId: "default-tenant",
      spaceId: "space-a",
      sourceId: "src-b22d",
      sourceHash,
      derivativeType: "versioned_record",
      derivativeId: "vr-b22d",
    });
    const ontology = ensureCanonicalUpperOntology(db, "operator");
    db.prepare(
      `INSERT INTO ontology_versioned_records
        (id, tenant_id, space_id, record_type, record_id, legacy_type, qualified_type,
         ontology_id, ontology_version, ontology_content_hash, mapping_path_json, source_id, source_hash, created_at)
       VALUES (?, 'default-tenant', 'space-a', 'memory', 'rec-1', 'note', 'entity.note',
               ?, ?, ?, '[]', 'src-b22d', ?, datetime('now'))`,
    ).run(
      `vr-b22d`,
      ontology.ontologyId,
      ontology.version,
      "sha256:" + "0".repeat(64),
      sourceHash,
    );
    expect(() =>
      resolveOntologyValidity(db, {
        tenantId: "default-tenant",
        spaceId: "space-a",
        recordType: "memory",
        recordId: "rec-1",
      }),
    ).toThrow(OntologyGovernanceError);
  });

  it("assertCandidateAuthoritative rejects revoked candidate sources", () => {
    registerOntologySource(db, {
      tenantId: "default-tenant",
      spaceId: "space-a",
      sourceId: "src-revoked",
      sourceHash,
      actor: "operator",
    });
    const candidate = extractOntologyCandidate(db, {
      tenantId: "default-tenant",
      spaceId: "space-a",
      sourceId: "src-revoked",
      sourceHash,
      sourceSpans: ["span:1"],
      extractorId: "extractor-b22d",
      extractorVersion: "1.0.0",
      candidateKind: "type",
      namespace: "batch22d",
      proposed: { id: "batch22d.example", semantics: { kind: "entity" } },
      confidenceLabel: "high",
      confidenceScore: 0.9,
      actor: "operator",
    });
    decideOntologyCandidate(db, {
      tenantId: "default-tenant",
      spaceId: "space-a",
      candidateId: candidate.id,
      decision: "approve",
      reviewerId: "operator",
      reason: "batch22d approve",
    });
    db.prepare(
      `UPDATE ontology_source_lifecycle SET status = 'revoked' WHERE tenant_id = ? AND space_id = ? AND source_id = ?`,
    ).run("default-tenant", "space-a", "src-revoked");
    expect(() =>
      assertCandidateAuthoritative(db, {
        tenantId: "default-tenant",
        spaceId: "space-a",
        candidateId: candidate.id,
      }),
    ).toThrow(/revoked|unverified|authoritative/i);
  });
});
