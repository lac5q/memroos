// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = path.join(os.tmpdir(), `ontology-registry-b14b-${crypto.randomUUID()}`);
const SOURCE_HASH = `sha256:${"c".repeat(64)}`;

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

describe("ontology registry batch14b — semver, pack graph, lifecycle", () => {
  it("compareSemver ordering treats missing prerelease as greater than tagged prerelease", async () => {
    const mod = await import("../registry");
    const parent = mod.ensureCanonicalUpperOntology(db, "operator");
    const doc = {
      id: mod.UPPER_ONTOLOGY_ID,
      version: "1.1.0-rc.1",
      definitions: [...mod.CORE_VOCABULARY],
      relationships: [...mod.CORE_RELATIONSHIPS],
      parent: { ontologyId: parent.ontologyId, version: parent.version, contentHash: parent.contentHash },
    };
    const hash = mod.canonicalContentHash(doc);
    mod.publishOntologyVersion(db, {
      ...doc,
      actor: "operator",
      suppliedHash: hash,
      projections: mod.ONTOLOGY_PROJECTIONS.map((p) => ({ projection: p, contentHash: hash })),
    });
    const row = db
      .prepare(`SELECT version FROM ontology_versions WHERE ontology_id = ? ORDER BY version DESC LIMIT 1`)
      .get(mod.UPPER_ONTOLOGY_ID) as { version: string };
    expect(row.version).toBe("1.1.0-rc.1");
  });

  it("registerDomainPack rejects invalid pack extension kind and dependency hash mismatch", async () => {
    const mod = await import("../registry");
    const ontology = mod.ensureCanonicalUpperOntology(db, "operator");
    const provenance = {
      sourceId: "src_b14b",
      classification: "internal" as const,
      importedAt: "2026-01-01T00:00:00Z",
      references: ["ref_b14b"],
    };
    expect(() =>
      mod.registerDomainPack(db, {
        namespace: "ext.bad",
        owner: "ops",
        version: "1.0.0",
        sourceHash: SOURCE_HASH,
        provenanceSummary: provenance,
        ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
        types: [
          {
            id: "ext.bad.leaf",
            semantics: { kind: "entity" },
            extends: { kind: "bogus" as "core", id: "entity" },
          },
        ],
        actor: "operator",
      }),
    ).toThrow(/extension kind is invalid/);

    const approved = mod.registerDomainPack(db, {
      namespace: "dep.base2",
      owner: "ops",
      version: "1.0.0",
      sourceHash: SOURCE_HASH,
      provenanceSummary: provenance,
      ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
      types: [
        {
          id: "dep.base2.root",
          semantics: { kind: "entity" },
          extends: {
            kind: "core",
            id: "entity",
            ontologyId: ontology.ontologyId,
            ontologyVersion: ontology.version,
            ontologyContentHash: ontology.contentHash,
          },
        },
      ],
      actor: "operator",
    });
    mod.transitionDomainPack(db, { packId: approved.id, toState: "approved", actor: "operator" });

    expect(() =>
      mod.registerDomainPack(db, {
        namespace: "dep.child2",
        owner: "ops",
        version: "1.0.0",
        sourceHash: SOURCE_HASH,
        provenanceSummary: provenance,
        ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
        dependencies: [{ namespace: "dep.base2", version: "1.0.0", sourceHash: `sha256:${"d".repeat(64)}` }],
        types: [
          {
            id: "dep.child2.leaf",
            semantics: { kind: "entity" },
            extends: {
              kind: "core",
              id: "entity",
              ontologyId: ontology.ontologyId,
              ontologyVersion: ontology.version,
              ontologyContentHash: ontology.contentHash,
            },
          },
        ],
        actor: "operator",
      }),
    ).toThrow(/source hash is stale/);
  });

  it("assertPackAuthoritative and transitionDomainPack enforce lifecycle guards", async () => {
    const mod = await import("../registry");
    const ontology = mod.ensureCanonicalUpperOntology(db, "operator");
    const pack = mod.registerDomainPack(db, {
      namespace: "auth.pack",
      owner: "ops",
      version: "1.0.0",
      sourceHash: SOURCE_HASH,
      provenanceSummary: {
        sourceId: "src_auth",
        classification: "internal",
        importedAt: "2026-01-01T00:00:00Z",
        references: ["ref_auth"],
      },
      ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
      types: [
        {
          id: "auth.pack.root",
          semantics: { kind: "entity" },
          extends: {
            kind: "core",
            id: "entity",
            ontologyId: ontology.ontologyId,
            ontologyVersion: ontology.version,
            ontologyContentHash: ontology.contentHash,
          },
        },
      ],
      actor: "operator",
    });
    expect(() => mod.assertPackAuthoritative(db, pack.id)).toThrow(/not approved/);
    mod.transitionDomainPack(db, { packId: pack.id, toState: "approved", actor: "operator" });
    expect(mod.assertPackAuthoritative(db, pack.id).lifecycleState).toBe("approved");
  });
});
