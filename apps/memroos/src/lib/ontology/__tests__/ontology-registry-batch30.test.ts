// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = path.join(os.tmpdir(), `ontology-registry-b30-${crypto.randomUUID()}`);
const SOURCE_HASH = `sha256:${"c".repeat(64)}`;
const WRONG_HASH = `sha256:${"d".repeat(64)}`;

let db: import("better-sqlite3").Database;
let closeDb: () => void;

async function loadDb() {
  process.env.MEMROOS_ROOT = TMP_ROOT;
  process.env.SQLITE_DB_PATH = path.join(TMP_ROOT, `ontology-b30-${crypto.randomUUID()}.db`);
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

describe("ontology registry batch30", () => {
  it("rejects unknown projection mirrors before publish (424)", async () => {
    const mod = await import("../registry");
    const parent = mod.ensureCanonicalUpperOntology(db, "operator");
    const baseDoc = {
      id: mod.UPPER_ONTOLOGY_ID,
      version: "1.5.0",
      definitions: [...mod.CORE_VOCABULARY],
      relationships: [...mod.CORE_RELATIONSHIPS],
      parent: { ontologyId: parent.ontologyId, version: parent.version, contentHash: parent.contentHash },
    };
    const hash = mod.canonicalContentHash(baseDoc);
    expect(() =>
      mod.publishOntologyVersion(db, {
        ...baseDoc,
        actor: "operator",
        suppliedHash: hash,
        projections: mod.ONTOLOGY_PROJECTIONS.map((p, i) =>
          i === 0
            ? { projection: "not-a-projection" as never, contentHash: hash }
            : { projection: p, contentHash: hash },
        ),
      }),
    ).toThrow(/Unknown projection/);
  });

  it("registerDomainPack requires a globally active parent ontology (816)", async () => {
    const mod = await import("../registry");
    const ontology = mod.ensureCanonicalUpperOntology(db, "operator");
    db.prepare(
      `UPDATE ontology_projection_mirrors SET status = 'stale' WHERE ontology_id = ? AND version = ? LIMIT 1`,
    ).run(ontology.ontologyId, ontology.version);
    const provenance = {
      sourceId: "src_b30",
      classification: "internal" as const,
      importedAt: "2026-01-01T00:00:00Z",
      references: [],
    };
    const baseType = {
      id: "batch30.pack.root",
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
        namespace: "batch30.pack",
        owner: "ops",
        version: "1.0.0",
        sourceHash: SOURCE_HASH,
        provenanceSummary: provenance,
        ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
        types: [baseType],
        actor: "operator",
      }),
    ).toThrow(/globally active/i);
  });

  it("registerDomainPack rejects parent ontology hash drift (819)", async () => {
    const mod = await import("../registry");
    const ontology = mod.ensureCanonicalUpperOntology(db, "operator");
    const provenance = {
      sourceId: "src_b30_hash",
      classification: "internal" as const,
      importedAt: "2026-01-01T00:00:00Z",
      references: [],
    };
    const baseType = {
      id: "batch30.hashpack.root",
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
        namespace: "batch30.hashpack",
        owner: "ops",
        version: "1.0.0",
        sourceHash: SOURCE_HASH,
        provenanceSummary: provenance,
        ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: WRONG_HASH },
        types: [baseType],
        actor: "operator",
      }),
    ).toThrow(/parent hash does not match/i);
  });

  /**
   * Line 404 is only reachable when a successor weakens core vocabulary while
   * retaining the same ids; publishOntologyVersion rejects immutable drift
   * earlier via assertCompatible on published definitions.
   */
  it.skip("assertCompatible core weaken branch — blocked by immutable definition guard (404)", () => {});
});
