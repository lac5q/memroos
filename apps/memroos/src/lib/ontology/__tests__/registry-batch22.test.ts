// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  CORE_RELATIONSHIPS,
  CORE_VOCABULARY,
  OntologyRegistryError,
  canonicalContentHash,
  ensureCanonicalUpperOntology,
  ONTOLOGY_PROJECTIONS,
  publishOntologyVersion,
  registerDomainPack,
  UPPER_ONTOLOGY_ID,
} from "../registry";

describe("ontology registry batch22 — semver pre-release and pack dependency validation", () => {
  it("publishOntologyVersion accepts stable release after prerelease coordinates", () => {
    const db = new Database(":memory:");
    initSchema(db);
    let parent = ensureCanonicalUpperOntology(db, "operator");
    for (const version of ["1.4.0-alpha.1", "1.4.0"]) {
      const doc = {
        id: UPPER_ONTOLOGY_ID,
        version,
        definitions: [...CORE_VOCABULARY],
        relationships: [...CORE_RELATIONSHIPS],
        parent: { ontologyId: parent.ontologyId, version: parent.version, contentHash: parent.contentHash },
      };
      const hash = canonicalContentHash(doc);
      parent = publishOntologyVersion(db, {
        ...doc,
        actor: "operator",
        suppliedHash: hash,
        projections: ONTOLOGY_PROJECTIONS.map((p) => ({ projection: p, contentHash: hash })),
      });
    }
    expect(parent.version).toBe("1.4.0");
    db.close();
  });

  it("registerDomainPack rejects dependency objects that are arrays", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const ontology = ensureCanonicalUpperOntology(db, "operator");
    const hash = "sha256:" + "c".repeat(64);
    expect(() =>
      registerDomainPack(db, {
        namespace: "batch22.invalid",
        owner: "operator",
        version: "1.0.0",
        actor: "operator",
        sourceHash: hash,
        ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
        dependencies: [{} as never],
        types: [
          {
            id: "batch22.invalid.entity",
            semantics: { kind: "entity", description: "b22" },
            extends: { id: "entity", namespace: UPPER_ONTOLOGY_ID, version: ontology.version },
          },
        ],
      }),
    ).toThrow(OntologyRegistryError);
    db.close();
  });
});
