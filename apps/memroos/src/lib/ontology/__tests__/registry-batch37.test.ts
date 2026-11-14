// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  CORE_RELATIONSHIPS,
  CORE_VOCABULARY,
  ONTOLOGY_PROJECTIONS,
  UPPER_ONTOLOGY_ID,
  canonicalContentHash,
  ensureCanonicalUpperOntology,
  publishOntologyVersion,
} from "../registry";

let db: Database.Database | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

describe("ontology registry batch37", () => {
  it("publishOntologyVersion rejects weakened core vocabulary (404)", () => {
    db = new Database(":memory:");
    initSchema(db);
    const first = ensureCanonicalUpperOntology(db, "operator-b37");
    const weakenedCore = CORE_VOCABULARY.map((definition) =>
      definition.id === "entity"
        ? { ...definition, semantics: { ...definition.semantics, kind: "weakened-b37" } }
        : definition,
    );
    const document = {
      id: UPPER_ONTOLOGY_ID,
      version: "1.0.1-b37",
      definitions: [...weakenedCore, { id: "ext.b37", semantics: { kind: "entity" } }],
      relationships: [
        ...CORE_RELATIONSHIPS,
        { from: "ext.b37", to: "entity", type: "is_a" },
      ],
    };
    const hash = canonicalContentHash(document);
    expect(() =>
      publishOntologyVersion(db!, {
        ...document,
        actor: "operator-b37",
        suppliedHash: hash,
        parent: {
          ontologyId: first.ontologyId,
          version: first.version,
          contentHash: first.contentHash,
        },
        projections: ONTOLOGY_PROJECTIONS.map((projection) => ({
          projection,
          contentHash: hash,
        })),
      }),
    ).toThrow(/immutable: entity|Core semantic cannot be changed/i);
  });
});