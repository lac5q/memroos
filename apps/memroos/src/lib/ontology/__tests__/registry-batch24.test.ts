// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  ensureCanonicalUpperOntology,
  registerDomainPack,
  transitionDomainPack,
} from "../registry";

const SOURCE_HASH = `sha256:${"a".repeat(64)}`;

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

describe("ontology registry batch24 — dependency hash validation", () => {
  it("registerDomainPack rejects dependency source hashes that are not sha256", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const ontology = ensureCanonicalUpperOntology(db, "operator");
    expect(() =>
      registerDomainPack(db, {
        namespace: "pack.b24.baddep",
        owner: "ops",
        version: "1.0.0",
        sourceHash: SOURCE_HASH,
        provenanceSummary: {
          sourceId: "src_b24",
          classification: "internal",
          importedAt: "2026-01-01T00:00:00.000Z",
          references: [],
        },
        ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
        dependencies: [{ namespace: "pack.b24.base", version: "1.0.0", sourceHash: "bad-hash" }],
        types: [packType(ontology, "pack.b24.baddep.root")],
        actor: "operator",
      }),
    ).toThrow(/sourceHash must be a sha256 hash/);
    db.close();
  });

  it("transitionDomainPack rejects transitions for unknown packs", () => {
    const db = new Database(":memory:");
    initSchema(db);
    expect(() =>
      transitionDomainPack(db, { packId: "pack.b24.missing", toState: "approved", actor: "operator" }),
    ).toThrow(/Unknown domain pack/);
    db.close();
  });
});
