// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { ensureCanonicalUpperOntology } from "../registry";
import { extractOntologyCandidate, OntologyGovernanceError } from "../candidates";

const TENANT = "tenant-b20";
const SPACE = "space-b20";
const SOURCE_HASH = `sha256:${"c".repeat(64)}`;

function baseInput() {
  return {
    tenantId: TENANT,
    spaceId: SPACE,
    sourceId: "source:b20",
    sourceHash: SOURCE_HASH,
    sourceSpans: ["span-1"],
    extractorId: "extractor-b20",
    extractorVersion: "1.0.0",
    candidateKind: "type" as const,
    namespace: "batch20",
    proposed: { id: "batch20.example", semantics: { kind: "entity" } },
    confidenceLabel: "high" as const,
    confidenceScore: 0.9,
    actor: "operator-b20",
  };
}

describe("ontology candidates batch20 — validation and provenance bands", () => {
  it("extractOntologyCandidate rejects malformed namespace and confidence mismatch", () => {
    const db = new Database(":memory:");
    initSchema(db);
    db.prepare(`INSERT INTO tenants (id, name) VALUES (?, ?)`).run(TENANT, "Tenant");
    ensureCanonicalUpperOntology(db, "operator");
    expect(() =>
      extractOntologyCandidate(db, {
        ...baseInput(),
        namespace: "INVALID NAMESPACE",
      }),
    ).toThrow(OntologyGovernanceError);
    expect(() =>
      extractOntologyCandidate(db, {
        ...baseInput(),
        provenanceTag: "INFERRED",
      }),
    ).toThrow(/provenance tag must match/i);
    db.close();
  });

  it("extractOntologyCandidate rejects empty required fields", () => {
    const db = new Database(":memory:");
    initSchema(db);
    expect(() =>
      extractOntologyCandidate(db, {
        ...baseInput(),
        actor: "  ",
      }),
    ).toThrow(/actor is required/i);
    db.close();
  });
});
