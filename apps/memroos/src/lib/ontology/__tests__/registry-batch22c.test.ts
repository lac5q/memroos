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
  extras: { aliases?: string[]; semantics?: Record<string, unknown> } = {},
) {
  return {
    id,
    aliases: extras.aliases,
    semantics: extras.semantics ?? { kind: "entity" },
    extends: {
      kind: "core" as const,
      id: "entity",
      ontologyId: ontology.ontologyId,
      ontologyVersion: ontology.version,
      ontologyContentHash: ontology.contentHash,
    },
  };
}

describe("ontology registry batch22c — semver, compatibility, pack registration", () => {
  it("publishOntologyVersion rejects non-advancing semver including equal pre-release coordinates", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const parent = ensureCanonicalUpperOntology(db, "operator");
    const betaDoc = {
      id: UPPER_ONTOLOGY_ID,
      version: "1.3.0-beta.1",
      definitions: [
        ...CORE_VOCABULARY,
        { id: "b22c.beta", semantics: { kind: "entity", description: "b22c" } },
      ],
      relationships: [...CORE_RELATIONSHIPS, { from: "b22c.beta", to: "entity", type: "is_a" }],
      parent: { ontologyId: parent.ontologyId, version: parent.version, contentHash: parent.contentHash },
    };
    const betaHash = canonicalContentHash(betaDoc);
    publishOntologyVersion(db, {
      ...betaDoc,
      actor: "operator",
      suppliedHash: betaHash,
      projections: ONTOLOGY_PROJECTIONS.map((p) => ({ projection: p, contentHash: betaHash })),
    });
    const releaseDoc = { ...betaDoc, version: "1.3.0" };
    const releaseHash = canonicalContentHash(releaseDoc);
    publishOntologyVersion(db, {
      ...releaseDoc,
      actor: "operator",
      suppliedHash: releaseHash,
      parent: { ontologyId: parent.ontologyId, version: "1.3.0-beta.1", contentHash: betaHash },
      projections: ONTOLOGY_PROJECTIONS.map((p) => ({ projection: p, contentHash: releaseHash })),
    });
    const regressedBeta = { ...betaDoc, version: "1.3.0-beta.2" };
    const regressedHash = canonicalContentHash(regressedBeta);
    expect(() =>
      publishOntologyVersion(db, {
        ...regressedBeta,
        actor: "operator",
        suppliedHash: regressedHash,
        parent: { ontologyId: parent.ontologyId, version: "1.3.0", contentHash: releaseHash },
        projections: ONTOLOGY_PROJECTIONS.map((p) => ({ projection: p, contentHash: regressedHash })),
      }),
    ).toThrow(/Version must advance/);
    const sameNumeric = { ...releaseDoc, version: "1.03.0" };
    const sameNumericHash = canonicalContentHash(sameNumeric);
    expect(() =>
      publishOntologyVersion(db, {
        ...sameNumeric,
        actor: "operator",
        suppliedHash: sameNumericHash,
        parent: { ontologyId: parent.ontologyId, version: "1.3.0", contentHash: releaseHash },
        projections: ONTOLOGY_PROJECTIONS.map((p) => ({ projection: p, contentHash: sameNumericHash })),
      }),
    ).toThrow(/Version must advance/);
    db.close();
  });

  it("publishOntologyVersion rejects initial and successor core vocabulary violations", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const missingCore = CORE_VOCABULARY.slice(1);
    const initialDoc = {
      id: UPPER_ONTOLOGY_ID,
      version: "0.1.0",
      definitions: missingCore,
      relationships: CORE_RELATIONSHIPS.filter(
        (rel) => missingCore.some((def) => def.id === rel.from) && missingCore.some((def) => def.id === rel.to),
      ),
    };
    const initialHash = canonicalContentHash(initialDoc);
    expect(() =>
      publishOntologyVersion(db, {
        ...initialDoc,
        actor: "operator",
        suppliedHash: initialHash,
        projections: ONTOLOGY_PROJECTIONS.map((p) => ({ projection: p, contentHash: initialHash })),
      }),
    ).toThrow(/core vocabulary/i);

    const base = ensureCanonicalUpperOntology(db, "operator");
    const weakenedCore = CORE_VOCABULARY.map((def) =>
      def.id === "entity" ? { ...def, semantics: { kind: "event" } } : def,
    );
    const nextDoc = {
      id: UPPER_ONTOLOGY_ID,
      version: "1.4.0",
      definitions: [...weakenedCore, { id: "b22c.weak", semantics: { kind: "entity" } }],
      relationships: [...CORE_RELATIONSHIPS, { from: "b22c.weak", to: "entity", type: "is_a" }],
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
    ).toThrow(/immutable|Core semantic cannot be changed/i);
    db.close();
  });

  it("registerDomainPack validates projections, collisions, relationships, and dependencies", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const ontology = ensureCanonicalUpperOntology(db, "operator");
    const basePack = {
      namespace: "pack.b22c.base",
      owner: "ops",
      version: "1.0.0",
      sourceHash: SOURCE_HASH,
      provenanceSummary: {
        sourceId: "src_b22c",
        classification: "internal" as const,
        importedAt: "2026-01-15T12:00:00.000Z",
        references: ["ref_b22c"],
      },
      ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
      types: [packType(ontology, "pack.b22c.base.root")],
      actor: "operator",
    };
    const approved = registerDomainPack(db, basePack);
    transitionDomainPack(db, { packId: approved.id, toState: "approved", actor: "operator" });

    expect(() =>
      registerDomainPack(db, {
        ...basePack,
        types: [packType(ontology, "pack.b22c.base.v2")],
      }),
    ).toThrow(/Pack already exists/i);

    expect(() =>
      registerDomainPack(db, {
        ...basePack,
        namespace: "pack.b22c.alias",
        version: "1.0.0",
        types: [
          {
            ...packType(ontology, "pack.b22c.alias.root"),
            aliases: ["pack.b22c.base.root"],
          },
        ],
      }),
    ).toThrow(/collides|shadows/i);

    expect(() =>
      registerDomainPack(db, {
        ...basePack,
        namespace: "pack.b22c.badsem",
        version: "1.0.0",
        types: [{ ...packType(ontology, "pack.b22c.badsem.root"), semantics: undefined as never }],
      }),
    ).toThrow(/requires semantics/i);

    expect(() =>
      registerDomainPack(db, {
        ...basePack,
        namespace: "pack.b22c.rel",
        version: "1.0.0",
        types: [packType(ontology, "pack.b22c.rel.root")],
        relationships: "not-an-array" as never,
      }),
    ).toThrow(/relationships must be an array/i);

    expect(() =>
      registerDomainPack(db, {
        ...basePack,
        namespace: "pack.b22c.endpoints",
        version: "1.0.0",
        types: [packType(ontology, "pack.b22c.endpoints.root")],
        relationships: [{ from: "pack.b22c.endpoints.root", to: "unknown.parent", type: "is_a" }],
      }),
    ).toThrow(/relationship endpoints/i);

    expect(() =>
      registerDomainPack(db, {
        namespace: "pack.b22c.child",
        owner: "ops",
        version: "1.0.0",
        sourceHash: DEP_HASH,
        provenanceSummary: basePack.provenanceSummary,
        ontology: { id: " ", version: ontology.version, contentHash: ontology.contentHash },
        types: [packType(ontology, "pack.b22c.child.root")],
        actor: "operator",
      }),
    ).toThrow(OntologyRegistryError);

    expect(() =>
      registerDomainPack(db, {
        namespace: "pack.b22c.child",
        owner: "ops",
        version: "1.0.0",
        sourceHash: DEP_HASH,
        provenanceSummary: basePack.provenanceSummary,
        ontology: ["invalid"] as never,
        types: [packType(ontology, "pack.b22c.child.root")],
        actor: "operator",
      }),
    ).toThrow(/ontology coordinates are required/i);

    expect(() =>
      registerDomainPack(db, {
        namespace: "pack.b22c.child",
        owner: "ops",
        version: "1.0.0",
        sourceHash: DEP_HASH,
        provenanceSummary: basePack.provenanceSummary,
        ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
        dependencies: [{} as never],
        types: [packType(ontology, "pack.b22c.child.root")],
        actor: "operator",
      }),
    ).toThrow(/dependency is invalid|dependency\.namespace is required/i);

    expect(() =>
      registerDomainPack(db, {
        namespace: "pack.b22c.child",
        owner: "ops",
        version: "1.0.0",
        sourceHash: DEP_HASH,
        provenanceSummary: basePack.provenanceSummary,
        ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
        dependencies: [{ namespace: "pack.b22c.base", version: "1.0.0", sourceHash: `sha256:${"f".repeat(64)}` }],
        types: [packType(ontology, "pack.b22c.child.root")],
        actor: "operator",
      }),
    ).toThrow(/Dependency source hash is stale/i);

    const child = registerDomainPack(db, {
      namespace: "pack.b22c.child",
      owner: "ops",
      version: "1.0.0",
      sourceHash: DEP_HASH,
      provenanceSummary: basePack.provenanceSummary,
      ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
      dependencies: [{ namespace: "pack.b22c.base", version: "1.0.0", sourceHash: SOURCE_HASH }],
      types: [packType(ontology, "pack.b22c.child.root")],
      actor: "operator",
    });
    expect(child.namespace).toBe("pack.b22c.child");
    db.close();
  });
});
