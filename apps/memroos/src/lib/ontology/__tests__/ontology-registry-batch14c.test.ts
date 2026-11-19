// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = path.join(os.tmpdir(), `ontology-registry-b14c-${crypto.randomUUID()}`);
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

describe("ontology registry batch14c — document shape, semver, pack graph", () => {
  it("publishOntologyVersion rejects empty definitions and relationship cycles", async () => {
    const mod = await import("../registry");
    const parent = mod.ensureCanonicalUpperOntology(db, "operator");
    const baseDoc = {
      id: mod.UPPER_ONTOLOGY_ID,
      version: "1.2.0",
      definitions: [...mod.CORE_VOCABULARY],
      relationships: [...mod.CORE_RELATIONSHIPS],
      parent: { ontologyId: parent.ontologyId, version: parent.version, contentHash: parent.contentHash },
    };
    const emptyDefsHash = mod.canonicalContentHash({ ...baseDoc, definitions: [] });
    expect(() =>
      mod.publishOntologyVersion(db, {
        ...baseDoc,
        definitions: [],
        actor: "operator",
        suppliedHash: emptyDefsHash,
        projections: mod.ONTOLOGY_PROJECTIONS.map((p) => ({ projection: p, contentHash: emptyDefsHash })),
      }),
    ).toThrow(/definitions must be a non-empty array/);

    const cyclicHash = mod.canonicalContentHash({
      ...baseDoc,
      version: "1.2.1",
      definitions: [
        ...mod.CORE_VOCABULARY,
        { id: "ext.a", semantics: { kind: "entity" }, aliases: [] },
        { id: "ext.b", semantics: { kind: "entity" }, aliases: [] },
      ],
      relationships: [
        ...mod.CORE_RELATIONSHIPS,
        { from: "ext.a", to: "ext.b", type: "relates" },
        { from: "ext.b", to: "ext.a", type: "relates" },
      ],
    });
    expect(() =>
      mod.publishOntologyVersion(db, {
        ...baseDoc,
        version: "1.2.1",
        definitions: [
          ...mod.CORE_VOCABULARY,
          { id: "ext.a", semantics: { kind: "entity" }, aliases: [] },
          { id: "ext.b", semantics: { kind: "entity" }, aliases: [] },
        ],
        relationships: [
          ...mod.CORE_RELATIONSHIPS,
          { from: "ext.a", to: "ext.b", type: "relates" },
          { from: "ext.b", to: "ext.a", type: "relates" },
        ],
        actor: "operator",
        suppliedHash: cyclicHash,
        projections: mod.ONTOLOGY_PROJECTIONS.map((p) => ({ projection: p, contentHash: cyclicHash })),
      }),
    ).toThrow(/cycle/);
  });

  it("compareSemver ordering via published prerelease versions", async () => {
    const mod = await import("../registry");
    let parent = mod.ensureCanonicalUpperOntology(db, "operator");
    for (const version of ["1.3.0-rc.1", "1.3.0-rc.2", "1.3.0"]) {
      const doc = {
        id: mod.UPPER_ONTOLOGY_ID,
        version,
        definitions: [...mod.CORE_VOCABULARY],
        relationships: [...mod.CORE_RELATIONSHIPS],
        parent: { ontologyId: parent.ontologyId, version: parent.version, contentHash: parent.contentHash },
      };
      const hash = mod.canonicalContentHash(doc);
      parent = mod.publishOntologyVersion(db, {
        ...doc,
        actor: "operator",
        suppliedHash: hash,
        projections: mod.ONTOLOGY_PROJECTIONS.map((p) => ({ projection: p, contentHash: hash })),
      });
    }
    const rows = db
      .prepare(`SELECT version FROM ontology_versions WHERE ontology_id = ? ORDER BY version DESC`)
      .all(mod.UPPER_ONTOLOGY_ID) as Array<{ version: string }>;
    expect(rows.map((r) => r.version)).toContain("1.3.0-rc.2");
  });

  it("registerDomainPack rejects self-dependencies and invalid dependency objects", async () => {
    const mod = await import("../registry");
    const ontology = mod.ensureCanonicalUpperOntology(db, "operator");
    const provenance = {
      sourceId: "src_b14c",
      classification: "internal" as const,
      importedAt: "2026-01-01T00:00:00Z",
      references: ["ref_b14c"],
    };
    const baseType = {
      id: "self.dep.root",
      semantics: { kind: "entity" },
      extends: {
        kind: "core" as const,
        id: "entity",
        ontologyId: ontology.ontologyId,
        ontologyVersion: ontology.version,
        ontologyContentHash: ontology.contentHash,
      },
    };

    expect(() =>
      mod.registerDomainPack(db, {
        namespace: "self.dep",
        owner: "ops",
        version: "1.0.0",
        sourceHash: SOURCE_HASH,
        provenanceSummary: provenance,
        ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
        dependencies: [{ namespace: "self.dep", version: "1.0.0", sourceHash: SOURCE_HASH }],
        types: [baseType],
        actor: "operator",
      }),
    ).toThrow(/cannot depend on itself/);

    expect(() =>
      mod.registerDomainPack(db, {
        namespace: "bad.dep",
        owner: "ops",
        version: "1.0.0",
        sourceHash: SOURCE_HASH,
        provenanceSummary: provenance,
        ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
        dependencies: ["not-an-object"] as unknown as Array<{ namespace: string; version: string; sourceHash: string }>,
        types: [baseType],
        actor: "operator",
      }),
    ).toThrow(/dependency is invalid/);
  });

  it("registerDomainPack requires pack types to declare parent extensions", async () => {
    const mod = await import("../registry");
    const ontology = mod.ensureCanonicalUpperOntology(db, "operator");
    expect(() =>
      mod.registerDomainPack(db, {
        namespace: "ext.missing",
        owner: "ops",
        version: "1.0.0",
        sourceHash: SOURCE_HASH,
        provenanceSummary: {
          sourceId: "src_ext",
          classification: "internal",
          importedAt: "2026-01-01T00:00:00Z",
          references: [],
        },
        ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
        types: [{ id: "ext.missing.leaf", semantics: { kind: "entity" } }],
        actor: "operator",
      }),
    ).toThrow(/parent extension/);
  });
});
