// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = path.join(os.tmpdir(), `ontology-registry-b16-${crypto.randomUUID()}`);
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

describe("ontology registry batch16 — shape, projections, pack collisions", () => {
  it("publishOntologyVersion rejects non-array relationships and invalid definition semantics", async () => {
    const mod = await registry();
    const parent = mod.ensureCanonicalUpperOntology(db, "operator");
    const base = {
      id: mod.UPPER_ONTOLOGY_ID,
      version: "1.4.0",
      definitions: [...mod.CORE_VOCABULARY],
      relationships: [...mod.CORE_RELATIONSHIPS],
      parent: { ontologyId: parent.ontologyId, version: parent.version, contentHash: parent.contentHash },
    };

    const relObjHash = mod.canonicalContentHash({ ...base, relationships: {} as never });
    expect(() =>
      mod.publishOntologyVersion(db, {
        ...base,
        relationships: {} as never,
        actor: "operator",
        suppliedHash: relObjHash,
        projections: mod.ONTOLOGY_PROJECTIONS.map((p) => ({ projection: p, contentHash: relObjHash })),
      }),
    ).toThrow(/relationships must be an array/);

    const badSemantics = {
      ...base,
      version: "1.4.1",
      definitions: [
        ...mod.CORE_VOCABULARY,
        { id: "bad.sem", semantics: "not-an-object" as never, aliases: [] },
      ],
    };
    const badHash = mod.canonicalContentHash(badSemantics);
    expect(() =>
      mod.publishOntologyVersion(db, {
        ...badSemantics,
        actor: "operator",
        suppliedHash: badHash,
        projections: mod.ONTOLOGY_PROJECTIONS.map((p) => ({ projection: p, contentHash: badHash })),
      }),
    ).toThrow(/requires semantics/);

    const dupAlias = {
      ...base,
      version: "1.4.2",
      definitions: [
        ...mod.CORE_VOCABULARY,
        { id: "dup.a", semantics: { kind: "entity" }, aliases: ["dup.a"] },
      ],
    };
    const dupHash = mod.canonicalContentHash(dupAlias);
    expect(() =>
      mod.publishOntologyVersion(db, {
        ...dupAlias,
        actor: "operator",
        suppliedHash: dupHash,
        projections: mod.ONTOLOGY_PROJECTIONS.map((p) => ({ projection: p, contentHash: dupHash })),
      }),
    ).toThrow(/Alias shadows/);
  });

  it("publishOntologyVersion rejects incomplete projection sets and stale projection hashes", async () => {
    const mod = await registry();
    const parent = mod.ensureCanonicalUpperOntology(db, "operator");
    const doc = {
      id: mod.UPPER_ONTOLOGY_ID,
      version: "1.5.0",
      definitions: [...mod.CORE_VOCABULARY],
      relationships: [...mod.CORE_RELATIONSHIPS],
      parent: { ontologyId: parent.ontologyId, version: parent.version, contentHash: parent.contentHash },
    };
    const hash = mod.canonicalContentHash(doc);
    expect(() =>
      mod.publishOntologyVersion(db, {
        ...doc,
        actor: "operator",
        suppliedHash: hash,
        projections: [{ projection: "git", contentHash: hash }],
      }),
    ).toThrow(/All canonical projections are required/);

    expect(() =>
      mod.publishOntologyVersion(db, {
        ...doc,
        actor: "operator",
        suppliedHash: hash,
        projections: mod.ONTOLOGY_PROJECTIONS.map((p) => ({ projection: p, contentHash: "sha256:wrong" })),
      }),
    ).toThrow(/Publication requires current/);
  });

  it("registerDomainPack rejects empty types, invalid aliases, and unknown pack ids", async () => {
    const mod = await registry();
    const ontology = mod.ensureCanonicalUpperOntology(db, "operator");
    const provenance = {
      sourceId: "src_b16",
      classification: "internal" as const,
      importedAt: "2026-01-01T00:00:00Z",
      references: ["ref_b16"],
    };

    expect(() =>
      mod.registerDomainPack(db, {
        namespace: "pack.b16",
        owner: "ops",
        version: "1.0.0",
        sourceHash: SOURCE_HASH,
        provenanceSummary: provenance,
        ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
        types: [],
        actor: "operator",
      }),
    ).toThrow(/types must be a non-empty array/);

    expect(() =>
      mod.registerDomainPack(db, {
        namespace: "pack.b16",
        owner: "ops",
        version: "1.0.0",
        sourceHash: SOURCE_HASH,
        provenanceSummary: provenance,
        ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
        types: [
          {
            ...packType(ontology, "pack.b16.root"),
            aliases: ["invalid"],
          },
        ],
        actor: "operator",
      }),
    ).toThrow(/Pack alias must use a valid namespace-qualified identifier/);

    expect(() => mod.assertPackAuthoritative(db, `ontpack_missing_${crypto.randomUUID()}`)).toThrow(
      /Unknown domain pack/,
    );
  });
});
