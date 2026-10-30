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
  registerDomainPack,
  transitionDomainPack,
  UPPER_ONTOLOGY_ID,
} from "../registry";

const SOURCE_HASH = `sha256:${"b".repeat(64)}`;
const DEP_HASH = `sha256:${"d".repeat(64)}`;

function packType(
  ontology: { ontologyId: string; version: string; contentHash: string },
  id: string,
) {
  return {
    id,
    semantics: { kind: "entity" },
    extends: {
      kind: "core" as const,
      id: "entity",
      ontologyId: ontology.ontologyId,
      ontologyVersion: ontology.version,
      ontologyContentHash: ontology.contentHash,
    },
  };
}

function provenanceSummary() {
  return {
    sourceId: "src_b23",
    classification: "internal" as const,
    importedAt: "2026-01-15T12:00:00.000Z",
    references: ["ref_b23"],
  };
}

describe("ontology registry batch23 — projections, pack validation, register guards", () => {
  it("publishOntologyVersion rejects duplicate projection entries", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const parent = ensureCanonicalUpperOntology(db, "operator");
    const doc = {
      id: UPPER_ONTOLOGY_ID,
      version: "1.5.0",
      definitions: [...CORE_VOCABULARY, { id: "b23.extra", semantics: { kind: "entity" } }],
      relationships: [...CORE_RELATIONSHIPS, { from: "b23.extra", to: "entity", type: "is_a" }],
      parent: { ontologyId: parent.ontologyId, version: parent.version, contentHash: parent.contentHash },
    };
    const hash = canonicalContentHash(doc);
    const duplicateProjection = ONTOLOGY_PROJECTIONS[0];
    expect(() =>
      publishOntologyVersion(db, {
        ...doc,
        actor: "operator",
        suppliedHash: hash,
        projections: ONTOLOGY_PROJECTIONS.map((p, index) =>
          index === ONTOLOGY_PROJECTIONS.length - 1
            ? { projection: duplicateProjection, contentHash: hash }
            : { projection: p, contentHash: hash },
        ),
      }),
    ).toThrow(/Duplicate projection/);
    db.close();
  });

  it("registerDomainPack rejects invalid sourceHash and self-dependency", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const ontology = ensureCanonicalUpperOntology(db, "operator");
    expect(() =>
      registerDomainPack(db, {
        namespace: "pack.b23.badhash",
        owner: "ops",
        version: "1.0.0",
        sourceHash: "not-a-hash",
        provenanceSummary: provenanceSummary(),
        ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
        types: [packType(ontology, "pack.b23.badhash.root")],
        actor: "operator",
      }),
    ).toThrow(/sourceHash must be a sha256 hash/);

    expect(() =>
      registerDomainPack(db, {
        namespace: "pack.b23.selfdep",
        owner: "ops",
        version: "1.0.0",
        sourceHash: SOURCE_HASH,
        provenanceSummary: provenanceSummary(),
        ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
        dependencies: [{ namespace: "pack.b23.selfdep", version: "1.0.0", sourceHash: SOURCE_HASH }],
        types: [packType(ontology, "pack.b23.selfdep.root")],
        actor: "operator",
      }),
    ).toThrow(/cannot depend on itself/);
    db.close();
  });

  it("registerDomainPack rejects type collisions with reserved identifiers", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const ontology = ensureCanonicalUpperOntology(db, "operator");
    const base = registerDomainPack(db, {
      namespace: "pack.b23.base",
      owner: "ops",
      version: "1.0.0",
      sourceHash: SOURCE_HASH,
      provenanceSummary: provenanceSummary(),
      ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
      types: [packType(ontology, "pack.b23.base.root")],
      actor: "operator",
    });
    transitionDomainPack(db, { packId: base.id, toState: "approved", actor: "operator" });
    expect(() =>
      registerDomainPack(db, {
        namespace: "pack.b23.collide",
        owner: "ops",
        version: "1.0.0",
        sourceHash: DEP_HASH,
        provenanceSummary: provenanceSummary(),
        ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
        types: [
          {
            ...packType(ontology, "pack.b23.collide.root"),
            aliases: ["pack.b23.base.root"],
          },
        ],
        actor: "operator",
      }),
    ).toThrow(/collides|shadows/);
    db.close();
  });
});
