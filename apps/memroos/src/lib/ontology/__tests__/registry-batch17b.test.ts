// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  OntologyRegistryError,
  canonicalContentHash,
  ensureCanonicalUpperOntology,
  bindOntologyProvenance,
  reconcileOntologyProjections,
  updateOntologyProjection,
  ONTOLOGY_PROJECTIONS,
} from "../registry";

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

describe("ontology registry batch17b — projections and provenance bindings", () => {
  it("canonicalContentHash is stable for upper ontology document shape", () => {
    const database = freshDb();
    const ontology = ensureCanonicalUpperOntology(database, "operator");
    const hash = canonicalContentHash({
      id: ontology.ontologyId,
      version: ontology.version,
      definitions: ontology.definitions,
      relationships: ontology.relationships,
    });
    expect(hash).toBe(ontology.contentHash);
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("reconcileOntologyProjections marks missing mirrors as missing status", () => {
    const database = freshDb();
    const ontology = ensureCanonicalUpperOntology(database, `actor-${randomUUID().slice(0, 6)}`);
    const reconciliation = reconcileOntologyProjections(database, ontology.ontologyId, ontology.version);
    expect(reconciliation).toHaveLength(ONTOLOGY_PROJECTIONS.length);
    expect(reconciliation.every((entry) => entry.status === "missing" || entry.current)).toBe(true);
    expect(reconciliation.some((entry) => entry.expectedHash === ontology.contentHash)).toBe(true);
  });

  it("updateOntologyProjection rejects unknown projection names", () => {
    const database = freshDb();
    const ontology = ensureCanonicalUpperOntology(database, "operator");
    expect(() =>
      updateOntologyProjection(database, {
        ontologyId: ontology.ontologyId,
        version: ontology.version,
        projection: "not-a-projection" as typeof ONTOLOGY_PROJECTIONS[number],
        contentHash: ontology.contentHash,
        status: "current",
        actor: "operator",
      }),
    ).toThrow(OntologyRegistryError);
  });

  it("bindOntologyProvenance rejects content hash mismatch", () => {
    const database = freshDb();
    const ontology = ensureCanonicalUpperOntology(database, "operator");
    for (const projection of ONTOLOGY_PROJECTIONS) {
      updateOntologyProjection(database, {
        ontologyId: ontology.ontologyId,
        version: ontology.version,
        projection,
        contentHash: ontology.contentHash,
        status: "current",
        actor: "operator",
      });
    }
    const wrongHash = `sha256:${createHash("sha256").update("wrong", "utf8").digest("hex")}`;
    expect(() =>
      bindOntologyProvenance(database, {
        recordType: "belief_candidate",
        recordId: `rec-${randomUUID()}`,
        ontologyId: ontology.ontologyId,
        ontologyVersion: ontology.version,
        ontologyContentHash: wrongHash,
        actor: "operator",
      }),
    ).toThrow(/content hash does not match/i);
  });

  it("bindOntologyProvenance is idempotent for identical binding", () => {
    const database = freshDb();
    const ontology = ensureCanonicalUpperOntology(database, "operator");
    for (const projection of ONTOLOGY_PROJECTIONS) {
      updateOntologyProjection(database, {
        ontologyId: ontology.ontologyId,
        version: ontology.version,
        projection,
        contentHash: ontology.contentHash,
        status: "current",
        actor: "operator",
      });
    }
    const recordId = `rec-${randomUUID()}`;
    const input = {
      recordType: "belief_candidate",
      recordId,
      ontologyId: ontology.ontologyId,
      ontologyVersion: ontology.version,
      ontologyContentHash: ontology.contentHash,
      actor: "operator",
    };
    const first = bindOntologyProvenance(database, input);
    const second = bindOntologyProvenance(database, input);
    expect(second.id).toBe(first.id);
  });
});
