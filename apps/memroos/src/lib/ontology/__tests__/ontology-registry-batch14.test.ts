// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = path.join(os.tmpdir(), `ontology-registry-b14-${crypto.randomUUID()}`);
const SOURCE_HASH = `sha256:${"a".repeat(64)}`;

let db: import("better-sqlite3").Database;
let closeDb: () => void;

async function loadDb() {
  process.env.MEMROOS_ROOT = TMP_ROOT;
  process.env.SQLITE_DB_PATH = path.join(TMP_ROOT, `ontology-${crypto.randomUUID()}.db`);
  vi.resetModules();
  const database = await import("@/lib/db");
  db = database.getDb();
  closeDb = database.closeDb;
}

beforeEach(async () => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  await loadDb();
});

afterEach(() => {
  closeDb?.();
  delete process.env.MEMROOS_ROOT;
  delete process.env.SQLITE_DB_PATH;
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

async function registry() {
  return import("../registry");
}

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

describe("ontology registry batch14 — validation and lifecycle edges", () => {
  it("publishOntologyVersion rejects empty actor and invalid semver", async () => {
    const mod = await registry();
    const ontology = mod.ensureCanonicalUpperOntology(db, "operator");
    const doc = {
      id: mod.UPPER_ONTOLOGY_ID,
      version: "not-a-version",
      definitions: [...mod.CORE_VOCABULARY],
      relationships: [...mod.CORE_RELATIONSHIPS],
      parent: { ontologyId: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
    };
    const hash = mod.canonicalContentHash(doc);
    expect(() =>
      mod.publishOntologyVersion(db, {
        ...doc,
        actor: "   ",
        suppliedHash: hash,
        projections: mod.ONTOLOGY_PROJECTIONS.map((p) => ({ projection: p, contentHash: hash })),
      }),
    ).toThrow(/actor is required/);

    expect(() =>
      mod.publishOntologyVersion(db, {
        ...doc,
        version: "bad",
        actor: "operator",
        suppliedHash: mod.canonicalContentHash({ ...doc, version: "bad" }),
        projections: mod.ONTOLOGY_PROJECTIONS.map((p) => ({
          projection: p,
          contentHash: mod.canonicalContentHash({ ...doc, version: "bad" }),
        })),
      }),
    ).toThrow(/Invalid semantic version/);
  });

  it("publishOntologyVersion rejects wrong ontology id and duplicate projections", async () => {
    const mod = await registry();
    mod.ensureCanonicalUpperOntology(db, "operator");
    const document = {
      id: "other.upper",
      version: "2.0.0",
      definitions: [...mod.CORE_VOCABULARY],
      relationships: [...mod.CORE_RELATIONSHIPS],
    };
    const hash = mod.canonicalContentHash(document as typeof document & { id: typeof mod.UPPER_ONTOLOGY_ID });
    expect(() =>
      mod.publishOntologyVersion(db, {
        ...(document as { id: typeof mod.UPPER_ONTOLOGY_ID; version: string; definitions: typeof mod.CORE_VOCABULARY; relationships: typeof mod.CORE_RELATIONSHIPS }),
        actor: "operator",
        projections: mod.ONTOLOGY_PROJECTIONS.map((p) => ({ projection: p, contentHash: hash })),
      }),
    ).toThrow(/canonical upper ontology/);

    const parent = mod.ensureCanonicalUpperOntology(db, "operator");
    const next = {
      id: mod.UPPER_ONTOLOGY_ID,
      version: "1.2.0",
      definitions: [
        ...mod.CORE_VOCABULARY,
        { id: "batch14_feat", semantics: { kind: "entity", description: "batch14" } },
      ],
      relationships: [...mod.CORE_RELATIONSHIPS, { from: "batch14_feat", to: "entity", type: "is_a" }],
      parent: { ontologyId: parent.ontologyId, version: parent.version, contentHash: parent.contentHash },
    };
    const nextHash = mod.canonicalContentHash(next);
    const dupProjections = [
      { projection: "git" as const, contentHash: nextHash },
      { projection: "git" as const, contentHash: nextHash },
      { projection: "sqlite" as const, contentHash: nextHash },
      { projection: "frontmatter" as const, contentHash: nextHash },
      { projection: "graph" as const, contentHash: nextHash },
    ];
    expect(() =>
      mod.publishOntologyVersion(db, {
        ...next,
        actor: "operator",
        suppliedHash: nextHash,
        projections: dupProjections,
      }),
    ).toThrow(/Duplicate projection/);
  });

  it("reconcileOntologyProjections and discoverOntology surface not_found paths", async () => {
    const mod = await registry();
    expect(() => mod.reconcileOntologyProjections(db, mod.UPPER_ONTOLOGY_ID, "9.9.9")).toThrow(/Unknown ontology version/);
    db.exec(`DELETE FROM ontology_registry; DELETE FROM ontology_versions;`);
    expect(() => mod.discoverOntology(db)).toThrow(/No active ontology version/);
  });

  it("updateOntologyProjection rejects unknown projection and status", async () => {
    const mod = await registry();
    const ontology = mod.ensureCanonicalUpperOntology(db, "operator");
    expect(() =>
      mod.updateOntologyProjection(db, {
        ontologyId: ontology.ontologyId,
        version: ontology.version,
        projection: "not_real" as "git",
        contentHash: ontology.contentHash,
        status: "current",
        actor: "operator",
      }),
    ).toThrow(/Unknown projection/);
    expect(() =>
      mod.updateOntologyProjection(db, {
        ontologyId: ontology.ontologyId,
        version: ontology.version,
        projection: "git",
        contentHash: ontology.contentHash,
        status: "bogus" as "current",
        actor: "operator",
      }),
    ).toThrow(/Unknown projection status/);
  });

  it("registerDomainPack rejects invalid namespace and self-dependency", async () => {
    const mod = await registry();
    const ontology = mod.ensureCanonicalUpperOntology(db, "operator");
    const provenance = {
      sourceId: "src_b14",
      classification: "internal" as const,
      importedAt: "2026-01-01T00:00:00Z",
      references: ["ref_b14"],
    };
    expect(() =>
      mod.registerDomainPack(db, {
        namespace: "INVALID",
        owner: "ops",
        version: "1.0.0",
        sourceHash: SOURCE_HASH,
        provenanceSummary: provenance,
        ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
        types: [packType(ontology, "invalid.child")],
        actor: "operator",
      }),
    ).toThrow(/namespace must be a simple dotted/);

    const approved = mod.registerDomainPack(db, {
      namespace: "dep.base",
      owner: "ops",
      version: "1.0.0",
      sourceHash: SOURCE_HASH,
      provenanceSummary: provenance,
      ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
      types: [packType(ontology, "dep.base.root")],
      actor: "operator",
    });
    mod.transitionDomainPack(db, { packId: approved.id, toState: "approved", actor: "operator" });

    expect(() =>
      mod.registerDomainPack(db, {
        namespace: "dep.child",
        owner: "ops",
        version: "1.0.0",
        sourceHash: SOURCE_HASH,
        provenanceSummary: provenance,
        ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
        dependencies: [{ namespace: "dep.child", version: "1.0.0", sourceHash: SOURCE_HASH }],
        types: [packType(ontology, "dep.child.leaf")],
        actor: "operator",
      }),
    ).toThrow(/cannot depend on itself/);
  });

  it("transitionDomainPack requires deprecation reason and valid replacement on retire", async () => {
    const mod = await registry();
    const ontology = mod.ensureCanonicalUpperOntology(db, "operator");
    const pack = mod.registerDomainPack(db, {
      namespace: "life.pack",
      owner: "ops",
      version: "1.0.0",
      sourceHash: SOURCE_HASH,
      provenanceSummary: {
        sourceId: "src_life",
        classification: "internal",
        importedAt: "2026-01-01T00:00:00Z",
        references: ["ref_life"],
      },
      ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
      types: [packType(ontology, "life.pack.child")],
      actor: "operator",
    });
    mod.transitionDomainPack(db, { packId: pack.id, toState: "approved", actor: "operator" });
    expect(() =>
      mod.transitionDomainPack(db, { packId: pack.id, toState: "retired", actor: "operator" }),
    ).toThrow(/Invalid pack lifecycle transition/);
    expect(() =>
      mod.transitionDomainPack(db, { packId: pack.id, toState: "deprecated", actor: "operator" }),
    ).toThrow(/Deprecation requires a reason/);
  });

  it("bindOntologyProvenance rejects ontology hash mismatch", async () => {
    const mod = await registry();
    const ontology = mod.ensureCanonicalUpperOntology(db, "operator");
    const recordId = crypto.randomUUID();
    const input = {
      recordType: "belief_candidate",
      recordId,
      ontologyId: ontology.ontologyId,
      ontologyVersion: ontology.version,
      ontologyContentHash: ontology.contentHash,
      actor: "operator",
    };
    expect(() =>
      mod.bindOntologyProvenance(db, {
        ...input,
        ontologyContentHash: `sha256:${"b".repeat(64)}`,
      }),
    ).toThrow(/content hash does not match/);
  });

  it("getDomainPack returns null for unknown id", async () => {
    const mod = await registry();
    expect(mod.getDomainPack(db, "missing-pack")).toBeNull();
  });
});
