// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  CORE_RELATIONSHIPS,
  CORE_VOCABULARY,
  canonicalContentHash,
  ensureCanonicalUpperOntology,
  ONTOLOGY_PROJECTIONS,
  OntologyRegistryError,
  publishOntologyVersion,
  UPPER_ONTOLOGY_ID,
} from "../registry";

describe("ontology registry batch20 — semver and projection validation", () => {
  it("publishOntologyVersion accepts advanced semver coordinates", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const base = ensureCanonicalUpperOntology(db, "operator");
    const doc = {
      id: UPPER_ONTOLOGY_ID,
      version: "1.1.0",
      definitions: [
        ...CORE_VOCABULARY,
        { id: "batch20.entity", semantics: { kind: "entity", description: "batch20" } },
      ],
      relationships: [...CORE_RELATIONSHIPS, { from: "batch20.entity", to: "entity", type: "is_a" }],
      parent: { ontologyId: base.ontologyId, version: base.version, contentHash: base.contentHash },
    };
    const hash = canonicalContentHash(doc);
    const published = publishOntologyVersion(db, {
      ...doc,
      actor: "operator",
      suppliedHash: hash,
      projections: ONTOLOGY_PROJECTIONS.map((projection) => ({ projection, contentHash: hash })),
    });
    expect(published.version).toBe("1.1.0");
    db.close();
  });

  it("publishOntologyVersion rejects unknown projections", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const base = ensureCanonicalUpperOntology(db, "operator");
    const doc = {
      id: UPPER_ONTOLOGY_ID,
      version: "1.2.0",
      definitions: CORE_VOCABULARY,
      relationships: CORE_RELATIONSHIPS,
      parent: { ontologyId: base.ontologyId, version: base.version, contentHash: base.contentHash },
    };
    const hash = canonicalContentHash(doc);
    expect(() =>
      publishOntologyVersion(db, {
        ...doc,
        actor: "operator",
        suppliedHash: hash,
        projections: [{ projection: "unknown-projection" as never, contentHash: hash }],
      }),
    ).toThrow(OntologyRegistryError);
    db.close();
  });
});
