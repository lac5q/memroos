// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const TMP_ROOT = path.join(os.tmpdir(), `ontology-registry-b13-${crypto.randomUUID()}`);
const SOURCE_HASH = `sha256:${"c".repeat(64)}`;

let db: import("better-sqlite3").Database;
let closeDb: () => void;

async function loadDb() {
  process.env["MEMROOS_ROOT"] = TMP_ROOT;
  process.env["SQLITE_DB_PATH"] = path.join(TMP_ROOT, `ontology-${crypto.randomUUID()}.db`);
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
  delete process.env["MEMROOS_ROOT"];
  delete process.env["SQLITE_DB_PATH"];
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

async function registry() {
  return import("../registry");
}

function packType(
  ontology: { ontologyId: string; version: string; contentHash: string },
  id: string
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

describe("ontology registry batch13", () => {
  it("publishOntologyVersion rejects initial parent declaration", async () => {
    const mod = await registry();
    db.exec(`DELETE FROM ontology_projection_mirrors; DELETE FROM ontology_versions; DELETE FROM ontology_registry;`);
    const document = {
      id: mod.UPPER_ONTOLOGY_ID,
      version: "1.0.0",
      definitions: [...mod.CORE_VOCABULARY],
      relationships: [...mod.CORE_RELATIONSHIPS],
    };
    const hash = mod.canonicalContentHash(document);
    expect(() =>
      mod.publishOntologyVersion(db, {
        ...document,
        actor: "operator",
        suppliedHash: hash,
        parent: {
          ontologyId: mod.UPPER_ONTOLOGY_ID,
          version: "0.9.0",
          contentHash: `sha256:${"e".repeat(64)}`,
        },
        projections: mod.ONTOLOGY_PROJECTIONS.map((p) => ({ projection: p, contentHash: hash })),
      })
    ).toThrow(/Initial ontology cannot declare a parent/);
  });

  it("publishOntologyVersion rejects successor with wrong parent hash", async () => {
    const mod = await registry();
    const ontology = mod.ensureCanonicalUpperOntology(db, "operator");
    const document = {
      id: mod.UPPER_ONTOLOGY_ID,
      version: "1.1.0",
      definitions: [
        ...mod.CORE_VOCABULARY,
        { id: "dossier", semantics: { kind: "entity", description: "case file" } },
      ],
      relationships: [...mod.CORE_RELATIONSHIPS, { from: "dossier", to: "entity", type: "is_a" }],
      parent: { ontologyId: ontology.ontologyId, version: ontology.version, contentHash: "sha256:" + "f".repeat(64) },
    };
    const hash = mod.canonicalContentHash(document);
    expect(() =>
      mod.publishOntologyVersion(db, {
        ...document,
        actor: "operator",
        suppliedHash: hash,
        projections: mod.ONTOLOGY_PROJECTIONS.map((p) => ({ projection: p, contentHash: hash })),
      })
    ).toThrow(/Successor must reference the active parent/);
  });

  it("bindOntologyProvenance returns existing binding idempotently", async () => {
    const mod = await registry();
    const ontology = mod.ensureCanonicalUpperOntology(db, "operator");
    const input = {
      recordType: "belief_candidate",
      recordId: `cand-${crypto.randomUUID()}`,
      ontologyId: ontology.ontologyId,
      ontologyVersion: ontology.version,
      ontologyContentHash: ontology.contentHash,
      actor: "operator",
    };
    const first = mod.bindOntologyProvenance(db, input);
    const second = mod.bindOntologyProvenance(db, input);
    expect(second.id).toBe(first.id);
  });

  it("bindOntologyProvenance rejects when projections are not globally active", async () => {
    const mod = await registry();
    const ontology = mod.ensureCanonicalUpperOntology(db, "operator");
    db.prepare(
      `UPDATE ontology_projection_mirrors SET status = 'stale' WHERE ontology_id = ? AND version = ?`
    ).run(ontology.ontologyId, ontology.version);
    expect(() =>
      mod.bindOntologyProvenance(db, {
        recordType: "test_record",
        recordId: crypto.randomUUID(),
        ontologyId: ontology.ontologyId,
        ontologyVersion: ontology.version,
        ontologyContentHash: ontology.contentHash,
        actor: "operator",
      })
    ).toThrow(/not globally active/);
  });

  it("registerDomainPack rejects invalid dependency objects and pack extension kinds", async () => {
    const mod = await registry();
    const { ontology } = { ontology: mod.ensureCanonicalUpperOntology(db, "operator") };
    const provenance = {
      sourceId: "src_pack_b13",
      classification: "internal" as const,
      importedAt: "2026-01-15T12:00:00.000Z",
      references: ["ref_audit_b13"],
    };
    expect(() =>
      mod.registerDomainPack(db, {
        namespace: "dep.invalid",
        owner: "ops",
        version: "1.0.0",
        sourceHash: SOURCE_HASH,
        provenanceSummary: provenance,
        ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
        dependencies: [null as unknown as { namespace: string; version: string; sourceHash: string }],
        types: [packType(ontology, "dep.invalid.child")],
        actor: "operator",
      })
    ).toThrow(/dependency is invalid/);

    expect(() =>
      mod.registerDomainPack(db, {
        namespace: "ext.invalid",
        owner: "ops",
        version: "1.0.0",
        sourceHash: SOURCE_HASH,
        provenanceSummary: {
          sourceId: "src_pack_b13_ext",
          classification: "internal" as const,
          importedAt: "2026-01-15T12:00:00.000Z",
          references: ["ref_audit_b13_ext"],
        },
        ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
        types: [
          {
            id: "ext.invalid.child",
            semantics: { kind: "entity" },
            extends: { kind: "unknown" as "core", id: "entity" },
          },
        ],
        actor: "operator",
      })
    ).toThrow(/Pack extension kind is invalid/);
  });

  it("assertPackAuthoritative and transitionDomainPack enforce lifecycle", async () => {
    const mod = await registry();
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
      types: [packType(ontology, "auth.pack.child")],
      actor: "operator",
    });
    expect(() => mod.assertPackAuthoritative(db, pack.id)).toThrow(/not approved/);
    expect(() => mod.transitionDomainPack(db, { packId: "missing-pack", toState: "approved", actor: "operator" })).toThrow(
      /Unknown domain pack/
    );
    mod.transitionDomainPack(db, { packId: pack.id, toState: "approved", actor: "operator" });
    expect(mod.assertPackAuthoritative(db, pack.id).lifecycleState).toBe("approved");
  });

  it("publishOntologyVersion advances semver across pre-release identifiers", async () => {
    const mod = await registry();
    const parent = mod.ensureCanonicalUpperOntology(db, "operator");
    const betaDoc = {
      id: mod.UPPER_ONTOLOGY_ID,
      version: "1.1.0-beta.1",
      definitions: [
        ...mod.CORE_VOCABULARY,
        { id: "beta_feat", semantics: { kind: "entity", description: "beta" } },
      ],
      relationships: [...mod.CORE_RELATIONSHIPS, { from: "beta_feat", to: "entity", type: "is_a" }],
      parent: { ontologyId: parent.ontologyId, version: parent.version, contentHash: parent.contentHash },
    };
    const betaHash = mod.canonicalContentHash(betaDoc);
    mod.publishOntologyVersion(db, {
      ...betaDoc,
      actor: "operator",
      suppliedHash: betaHash,
      projections: mod.ONTOLOGY_PROJECTIONS.map((p) => ({ projection: p, contentHash: betaHash })),
    });
    const releaseDoc = {
      ...betaDoc,
      version: "1.1.0",
      definitions: betaDoc.definitions,
    };
    const releaseHash = mod.canonicalContentHash(releaseDoc);
    const published = mod.publishOntologyVersion(db, {
      ...releaseDoc,
      actor: "operator",
      suppliedHash: releaseHash,
      parent: { ontologyId: parent.ontologyId, version: "1.1.0-beta.1", contentHash: betaHash },
      projections: mod.ONTOLOGY_PROJECTIONS.map((p) => ({ projection: p, contentHash: releaseHash })),
    });
    expect(published.version).toBe("1.1.0");
  });
});
