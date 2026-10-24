// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { ensureCanonicalUpperOntology } from "../registry";
import {
  CANDIDATE_PROVENANCE_TAGS,
  OntologyGovernanceError,
  decideOntologyCandidate,
  extractOntologyCandidate,
  provenanceTagFromConfidence,
  registerOntologyPolicyContext,
} from "../candidates";

let db: Database.Database | null = null;

const sourceHash = `sha256:${"c".repeat(64)}`;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  ensureCanonicalUpperOntology(db, "operator");
  return db;
}

afterEach(() => {
  db?.close();
  db = null;
});

function baseExtractInput(tenantId: string, spaceId: string) {
  return {
    tenantId,
    spaceId,
    sourceId: `source-${randomUUID()}`,
    sourceHash,
    sourceSpans: ["span:1"],
    extractorId: "extractor-b17b",
    extractorVersion: "1.0.0",
    candidateKind: "type" as const,
    namespace: "finance",
    proposed: { id: "finance.invoice", semantics: { kind: "entity" } },
    confidenceLabel: "high" as const,
    confidenceScore: 0.9,
    actor: "agent-1",
  };
}

describe("ontology candidates batch17b — provenance tags and governance guards", () => {
  it("provenanceTagFromConfidence maps bands to ONTO-03 tags", () => {
    expect(provenanceTagFromConfidence("high")).toBe("EXTRACTED");
    expect(provenanceTagFromConfidence("medium")).toBe("INFERRED");
    expect(provenanceTagFromConfidence("low")).toBe("AMBIGUOUS");
    expect(CANDIDATE_PROVENANCE_TAGS).toContain("INFERRED");
  });

  it("registerOntologyPolicyContext rejects expired expiresAt", () => {
    const database = freshDb();
    const contextHash = `sha256:${createHash("sha256").update("ctx", "utf8").digest("hex")}`;
    expect(() =>
      registerOntologyPolicyContext(database, {
        tenantId: "tenant-a",
        spaceId: "space-a",
        contextHash,
        policyVersion: "1.0.0",
        actor: "operator",
        expiresAt: "2020-01-01T00:00:00.000Z",
      }),
    ).toThrow(OntologyGovernanceError);
  });

  it("extractOntologyCandidate rejects confidence label/score mismatch", () => {
    const database = freshDb();
    expect(() =>
      extractOntologyCandidate(database, {
        ...baseExtractInput("tenant-a", "space-a"),
        confidenceLabel: "low",
        confidenceScore: 0.9,
      }),
    ).toThrow(/confidence label does not match/i);
  });

  it("extractOntologyCandidate dedupes identical evidence hash", () => {
    const database = freshDb();
    const input = baseExtractInput("tenant-a", "space-a");
    const first = extractOntologyCandidate(database, input);
    const second = extractOntologyCandidate(database, input);
    expect(second.id).toBe(first.id);
    expect(second.status).toBe("pending");
  });

  it("decideOntologyCandidate rejects decisions on promoted candidates", () => {
    const database = freshDb();
    const candidate = extractOntologyCandidate(database, baseExtractInput("tenant-a", "space-a"));
    database.prepare(`UPDATE ontology_candidates SET status = 'promoted' WHERE id = ?`).run(candidate.id);
    expect(() =>
      decideOntologyCandidate(database, {
        candidateId: candidate.id,
        tenantId: "tenant-a",
        spaceId: "space-a",
        decision: "approve",
        reviewerId: "reviewer-1",
        reason: "late approve",
      }),
    ).toThrow(/not allowed/i);
  });
});
