// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { ensureCanonicalUpperOntology, registerDomainPack } from "../registry";

const SOURCE_HASH = `sha256:${"e".repeat(64)}`;

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

describe("ontology registry batch27 — pack registration guards", () => {
  it("registerDomainPack rejects missing ontology coordinates, hash mismatch, and bad dependency namespaces", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const ontology = ensureCanonicalUpperOntology(db, "operator");
    expect(() =>
      registerDomainPack(db, {
        namespace: "pack.b27.nocoords",
        owner: "ops",
        version: "1.0.0",
        sourceHash: SOURCE_HASH,
        provenanceSummary: {
          sourceId: "src_b27",
          classification: "internal",
          importedAt: "2026-01-01T00:00:00.000Z",
          references: [],
        },
        ontology: null as never,
        types: [packType(ontology, "pack.b27.nocoords.root")],
        actor: "operator",
      }),
    ).toThrow(/ontology coordinates are required/);

    expect(() =>
      registerDomainPack(db, {
        namespace: "pack.b27.badparent",
        owner: "ops",
        version: "1.0.0",
        sourceHash: SOURCE_HASH,
        provenanceSummary: {
          sourceId: "src_b27",
          classification: "internal",
          importedAt: "2026-01-01T00:00:00.000Z",
          references: [],
        },
        ontology: {
          id: ontology.ontologyId,
          version: ontology.version,
          contentHash: `sha256:${"f".repeat(64)}`,
        },
        types: [packType(ontology, "pack.b27.badparent.root")],
        actor: "operator",
      }),
    ).toThrow(/parent hash does not match/);

    expect(() =>
      registerDomainPack(db, {
        namespace: "pack.b27.baddepns",
        owner: "ops",
        version: "1.0.0",
        sourceHash: SOURCE_HASH,
        provenanceSummary: {
          sourceId: "src_b27",
          classification: "internal",
          importedAt: "2026-01-01T00:00:00.000Z",
          references: [],
        },
        ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
        dependencies: [{ namespace: "INVALID NAMESPACE", version: "1.0.0", sourceHash: SOURCE_HASH }],
        types: [packType(ontology, "pack.b27.baddepns.root")],
        actor: "operator",
      }),
    ).toThrow(/dependency.namespace must be a valid namespace/);
    db.close();
  });

  it("registerDomainPack rejects duplicate pack type ids in the same submission", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const ontology = ensureCanonicalUpperOntology(db, "operator");
    const duplicateType = packType(ontology, "pack.b27.collide.root");
    expect(() =>
      registerDomainPack(db, {
        namespace: "pack.b27.collide",
        owner: "ops",
        version: "1.0.0",
        sourceHash: SOURCE_HASH,
        provenanceSummary: {
          sourceId: "src_b27",
          classification: "internal",
          importedAt: "2026-01-01T00:00:00.000Z",
          references: [],
        },
        ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
        types: [duplicateType, duplicateType],
        actor: "operator",
      }),
    ).toThrow(/collides|Duplicate|conflict/i);
    db.close();
  });
});
