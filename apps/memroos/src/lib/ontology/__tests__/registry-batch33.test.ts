// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import {
  CORE_RELATIONSHIPS,
  CORE_VOCABULARY,
  ONTOLOGY_PROJECTIONS,
  UPPER_ONTOLOGY_ID,
  canonicalContentHash,
  ensureCanonicalUpperOntology,
  publishOntologyVersion,
  registerDomainPack,
} from "../registry";
import { initSchema } from "@/lib/db-schema";

describe("ontology registry batch33", () => {
  it("publishOntologyVersion rejects weakened core vocabulary (404)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const base = ensureCanonicalUpperOntology(db, "operator");
    const weakenedCore = CORE_VOCABULARY.map((def) =>
      def.id === "entity" ? { ...def, semantics: { kind: "event" } } : def,
    );
    const nextDoc = {
      id: UPPER_ONTOLOGY_ID,
      version: "1.5.0",
      definitions: weakenedCore,
      relationships: CORE_RELATIONSHIPS,
      parent: { ontologyId: base.ontologyId, version: base.version, contentHash: base.contentHash },
    };
    const nextHash = canonicalContentHash(nextDoc);
    expect(() =>
      publishOntologyVersion(db, {
        ...nextDoc,
        actor: "operator",
        suppliedHash: nextHash,
        projections: ONTOLOGY_PROJECTIONS.map((p) => ({ projection: p, contentHash: nextHash })),
      }),
    ).toThrow(/Core semantic cannot be changed|Published definition is immutable: entity/i);
    db.close();
  });

  it("registerDomainPack rejects non-array dependencies (819)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const ontology = ensureCanonicalUpperOntology(db, "operator");
    expect(() =>
      registerDomainPack(db, {
        namespace: `pack.b33.${randomUUID().slice(0, 8)}`,
        owner: "ops",
        version: "1.0.0",
        sourceHash: "sha256:" + "a".repeat(64),
        provenanceSummary: {
          sourceId: "src_b33",
          classification: "internal",
          importedAt: "2026-11-10T00:00:00.000Z",
          references: [],
        },
        ontology: {
          id: ontology.ontologyId,
          version: ontology.version,
          contentHash: ontology.contentHash,
        },
        dependencies: "[]" as unknown as [],
        types: [],
        actor: "operator",
      }),
    ).toThrow(/dependencies must be an array/i);
    db.close();
  });
});
