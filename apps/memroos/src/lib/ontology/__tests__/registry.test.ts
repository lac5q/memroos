// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const TMP_ROOT = path.join(os.tmpdir(), `ontology-registry-${crypto.randomUUID()}`);
const SOURCE_HASH = `sha256:${"a".repeat(64)}`;

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

async function canonical() {
  const mod = await registry();
  return { mod, ontology: mod.ensureCanonicalUpperOntology(db, "operator") };
}

function nextDocument(mod: Awaited<ReturnType<typeof registry>>, parent: { version: string; contentHash: string }) {
  return {
    id: mod.UPPER_ONTOLOGY_ID,
    version: "1.1.0",
    definitions: [
      ...mod.CORE_VOCABULARY,
      { id: "dossier", aliases: ["case_file"], semantics: { kind: "entity", description: "A curated multi-source case file." } },
    ],
    relationships: [
      ...mod.CORE_RELATIONSHIPS,
      { from: "dossier", to: "entity", type: "is_a" },
    ],
    parent: { ontologyId: mod.UPPER_ONTOLOGY_ID, version: parent.version, contentHash: parent.contentHash },
  };
}

function packType(
  ontology: { ontologyId?: string; id?: string; version: string; contentHash: string },
  id: string,
  options: { aliases?: string[]; semantics?: Record<string, unknown> } = {}
) {
  return {
    id,
    aliases: options.aliases,
    semantics: options.semantics ?? {},
    extends: {
      kind: "core" as const,
      id: "entity",
      ontologyId: ontology.ontologyId ?? ontology.id,
      ontologyVersion: ontology.version,
      ontologyContentHash: ontology.contentHash,
    },
  };
}

describe("ontology registry validation", () => {
  it("VAL-ONTO-001 creates one canonical active upper ontology with stable hashes and strict version lookup", async () => {
    const { mod, ontology } = await canonical();
    expect(ontology.contentHash).toBe(mod.canonicalContentHash({
      id: ontology.ontologyId, version: ontology.version, definitions: ontology.definitions, relationships: ontology.relationships,
    }));
    expect(mod.discoverOntology(db).version).toBe("1.0.0");
    expect(mod.discoverOntology(db, { version: "1.0.0" }).requested).toBe(true);
    expect(() => mod.discoverOntology(db, { version: "9.9.9" })).toThrow(/Unknown ontology version/);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM ontology_registry`).get()).toMatchObject({ count: 1 });
  });

  it("VAL-ONTO-011 projects the git upper ontology (~12–15+ core types) including required ONTO-01 vocabulary", async () => {
    const { mod, ontology } = await canonical();
    const required = [
      "person", "organization", "team", "agent", "skill", "tool", "project", "task",
      "event", "source", "claim", "decision", "policy", "relationship_path",
    ];
    const ids = ontology.definitions.map((definition) => definition.id);
    expect(ids).toEqual(mod.CORE_VOCABULARY.map((definition) => definition.id));
    expect(mod.CORE_VOCABULARY.length).toBeGreaterThanOrEqual(14);
    expect(mod.CORE_VOCABULARY.length).toBeLessThanOrEqual(20);
    for (const id of required) {
      expect(ids).toContain(id);
    }
    expect(ontology.definitions.find((d) => d.id === "organization")?.aliases).toContain("account");
    expect(ontology.definitions.find((d) => d.id === "event")?.aliases).toContain("meeting");
    expect(ontology.definitions.find((d) => d.id === "source")?.aliases).toContain("document");
    expect(ontology.relationships).toEqual([...mod.CORE_RELATIONSHIPS]);
  });

  it("VAL-ONTO-002 rejects malformed, duplicate, regressive, unparented, and hash-mismatched publication", async () => {
    const { mod, ontology } = await canonical();
    const valid = nextDocument(mod, ontology);
    const hash = mod.canonicalContentHash(valid);
    expect(() => mod.publishOntologyVersion(db, { ...valid, actor: "operator", suppliedHash: "sha256:bad", projections: [] })).toThrow(/suppliedHash/);
    expect(() => mod.publishOntologyVersion(db, { ...valid, version: "wat", actor: "operator", suppliedHash: hash, projections: [] })).toThrow(/semantic version/);
    const projections = mod.ONTOLOGY_PROJECTIONS.map((projection) => ({ projection, contentHash: hash }));
    const published = mod.publishOntologyVersion(db, { ...valid, actor: "operator", suppliedHash: hash, projections });
    expect(published.version).toBe("1.1.0");
    expect(() => mod.publishOntologyVersion(db, { ...valid, actor: "operator", suppliedHash: hash, projections })).toThrow(/already exists/);
    const regressive = { ...valid, version: "1.0.1", parent: valid.parent };
    const regressiveHash = mod.canonicalContentHash(regressive);
    expect(() => mod.publishOntologyVersion(db, { ...regressive, actor: "operator", suppliedHash: regressiveHash, projections: mod.ONTOLOGY_PROJECTIONS.map((projection) => ({ projection, contentHash: regressiveHash })) })).toThrow(/must advance/);
  });

  it("VAL-ONTO-003 rejects duplicate aliases, broken relationship endpoints, cycles, and weakened published semantics", async () => {
    const { mod, ontology } = await canonical();
    const document = nextDocument(mod, ontology);
    const duplicate = {
      ...document,
      definitions: [...document.definitions, { id: "duplicate", aliases: ["entity"], semantics: { kind: "entity" } }],
    };
    const duplicateHash = mod.canonicalContentHash(duplicate);
    expect(() => mod.publishOntologyVersion(db, {
      ...duplicate,
      actor: "operator", suppliedHash: duplicateHash,
      projections: mod.ONTOLOGY_PROJECTIONS.map((projection) => ({ projection, contentHash: duplicateHash })),
    })).toThrow(/Alias shadows/);
    const broken = { ...document, relationships: [...document.relationships, { from: "dossier", to: "missing", type: "is_a" }] };
    const brokenHash = mod.canonicalContentHash(broken);
    expect(() => mod.publishOntologyVersion(db, {
      ...broken, actor: "operator", suppliedHash: brokenHash,
      projections: mod.ONTOLOGY_PROJECTIONS.map((projection) => ({ projection, contentHash: brokenHash })),
    })).toThrow(/endpoints/);
    const cyclic = { ...document, relationships: [...document.relationships, { from: "entity", to: "dossier", type: "is_a" }] };
    const cyclicHash = mod.canonicalContentHash(cyclic);
    expect(() => mod.publishOntologyVersion(db, { ...cyclic, actor: "operator", suppliedHash: cyclicHash, projections: mod.ONTOLOGY_PROJECTIONS.map((projection) => ({ projection, contentHash: cyclicHash })) })).toThrow(/cycle/);
    const weakened = { ...document, definitions: document.definitions.map((definition) => definition.id === "agent" ? { ...definition, semantics: { kind: "entity", description: "different" } } : definition) };
    const weakenedHash = mod.canonicalContentHash(weakened);
    expect(() => mod.publishOntologyVersion(db, { ...weakened, actor: "operator", suppliedHash: weakenedHash, projections: mod.ONTOLOGY_PROJECTIONS.map((projection) => ({ projection, contentHash: weakenedHash })) })).toThrow(/immutable/);
    const published = mod.publishOntologyVersion(db, {
      ...document, actor: "operator", suppliedHash: mod.canonicalContentHash(document),
      projections: mod.ONTOLOGY_PROJECTIONS.map((projection) => ({ projection, contentHash: mod.canonicalContentHash(document) })),
    });
    const relationshipRemoved = {
      ...nextDocument(mod, published),
      version: "1.2.0",
      relationships: document.relationships.filter((relationship) => relationship.from !== "dossier"),
    };
    const relationshipRemovedHash = mod.canonicalContentHash(relationshipRemoved);
    expect(() => mod.publishOntologyVersion(db, {
      ...relationshipRemoved, actor: "operator", suppliedHash: relationshipRemovedHash,
      projections: mod.ONTOLOGY_PROJECTIONS.map((projection) => ({ projection, contentHash: relationshipRemovedHash })),
    })).toThrow(/Published relationship is immutable/);
    const relationshipChanged = {
      ...nextDocument(mod, published),
      version: "1.2.0",
      relationships: document.relationships.map((relationship) => relationship.from === "agent"
        ? { ...relationship, type: "acts_as" }
        : relationship),
    };
    const relationshipChangedHash = mod.canonicalContentHash(relationshipChanged);
    expect(() => mod.publishOntologyVersion(db, {
      ...relationshipChanged, actor: "operator", suppliedHash: relationshipChangedHash,
      projections: mod.ONTOLOGY_PROJECTIONS.map((projection) => ({ projection, contentHash: relationshipChangedHash })),
    })).toThrow(/Published relationship is immutable/);
  });

  it("VAL-ONTO-004 reconciles every mirror and does not treat stale, divergent, or failed mirrors as globally active", async () => {
    const { mod, ontology } = await canonical();
    for (const status of ["stale", "divergent", "failed"] as const) {
      const reconciled = mod.updateOntologyProjection(db, {
        ontologyId: ontology.ontologyId, version: ontology.version, projection: "git", contentHash: status === "divergent" ? SOURCE_HASH : ontology.contentHash, status, actor: "operator",
      });
      expect(reconciled.find((entry) => entry.projection === "git")?.current).toBe(false);
      expect(mod.discoverOntology(db).globallyActive).toBe(false);
      mod.updateOntologyProjection(db, { ontologyId: ontology.ontologyId, version: ontology.version, projection: "git", contentHash: ontology.contentHash, status: "current", actor: "operator" });
      expect(mod.discoverOntology(db).globallyActive).toBe(true);
    }
  });

  it("VAL-ONTO-005 writes immutable ontology provenance and preserves historical bindings after advancement", async () => {
    const { mod, ontology } = await canonical();
    const binding = mod.bindOntologyProvenance(db, {
      recordType: "memory", recordId: "memory-1", ontologyId: ontology.ontologyId, ontologyVersion: ontology.version, ontologyContentHash: ontology.contentHash, actor: "operator",
    });
    const document = nextDocument(mod, ontology);
    const hash = mod.canonicalContentHash(document);
    mod.publishOntologyVersion(db, { ...document, actor: "operator", suppliedHash: hash, projections: mod.ONTOLOGY_PROJECTIONS.map((projection) => ({ projection, contentHash: hash })) });
    expect(mod.getOntologyProvenanceBinding(db, "memory", "memory-1")).toEqual(binding);
    expect(() => mod.bindOntologyProvenance(db, {
      recordType: "memory", recordId: "memory-1", ontologyId: document.id, ontologyVersion: document.version, ontologyContentHash: hash, actor: "operator",
    })).toThrow(/immutable ontology binding/);
  });

  it("VAL-ONTO-006 registers only valid draft packs and keeps raw source sentinels out of results and audit metadata", async () => {
    const { mod, ontology } = await canonical();
    const sentinel = "RAW-PACK-SOURCE-MUST-NOT-PERSIST";
    const pack = mod.registerDomainPack(db, {
      namespace: "finance.ops", owner: "finance", version: "1.0.0", sourceHash: SOURCE_HASH,
      provenanceSummary: { sourceId: "src_pack", classification: "internal", importedAt: "2026-07-12T00:00:00Z", references: ["ref_pack"] },
      ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
      types: [packType(ontology, "finance.ops.invoice", { semantics: { kind: "entity" } })],
      actor: "operator",
      ...( { source: sentinel } as Record<string, unknown>),
    } as never);
    expect(pack.lifecycleState).toBe("draft");
    expect(JSON.stringify(pack)).not.toContain(sentinel);
    const audit = db.prepare(`SELECT metadata_json FROM audit_entries WHERE event_type = 'ontology_pack_registered'`).get() as { metadata_json: string };
    expect(audit.metadata_json).not.toContain(sentinel);
    expect(() => mod.registerDomainPack(db, {
      namespace: "nested", owner: "finance", version: "1.0.0", sourceHash: SOURCE_HASH,
      provenanceSummary: { sourceId: "src_nested", classification: "internal", importedAt: "2026-07-12T00:00:00Z", references: ["ref_nested"], nested: { payload: sentinel } },
      ontology: pack.ontology, types: [packType(pack.ontology, "nested.record")], actor: "operator",
    })).toThrow(/normalized safe contract/);
    expect(() => mod.registerDomainPack(db, {
      namespace: "annotated", owner: "finance", version: "1.0.0", sourceHash: SOURCE_HASH,
      provenanceSummary: { note: sentinel },
      ontology: pack.ontology, types: [packType(pack.ontology, "annotated.record")], actor: "operator",
    })).toThrow(/normalized safe contract/);
    expect(() => mod.registerDomainPack(db, {
      namespace: "not valid!", owner: "finance", version: "1.0.1", sourceHash: SOURCE_HASH, provenanceSummary: { sourceId: "src_invalid", classification: "internal", importedAt: "2026-07-12T00:00:00Z", references: ["ref_invalid"] },
      ontology: pack.ontology, types: [packType(pack.ontology, "not valid!.invoice")], actor: "operator",
    })).toThrow(/namespace/);
  });

  it("hardens every provenance nesting shape and scrubs unsafe legacy rows during the additive upgrade", async () => {
    const { mod, ontology } = await canonical();
    const sentinel = "RAW-PACK-PROVENANCE-MUST-NOT-SURVIVE";
    const valid = {
      namespace: "safe", owner: "ops", version: "1.0.0", sourceHash: SOURCE_HASH,
      ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
      types: [packType(ontology, "safe.record")], actor: "operator",
    };
    for (const provenanceSummary of [
      { sourceId: "src_safe", classification: "internal", importedAt: "2026-07-12T00:00:00Z", references: ["ref_safe"], payload: sentinel },
      { sourceId: "src_safe", classification: "internal", importedAt: "2026-07-12T00:00:00Z", references: [{ payload: sentinel }] },
      { sourceId: "src_safe", classification: "internal", importedAt: "2026-07-12T00:00:00Z", references: ["ref_safe"], source: { payload: sentinel } },
    ]) {
      expect(() => mod.registerDomainPack(db, { ...valid, provenanceSummary })).toThrow(/normalized safe contract/);
    }
    db.prepare(`INSERT INTO ontology_packs (id, namespace, owner, version, source_hash, provenance_summary_json, ontology_id, ontology_version, ontology_content_hash, types_json, relationships_json, dependencies_json, lifecycle_state, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`)
      .run("legacy-pack", "legacy", "ops", "1.0.0", SOURCE_HASH, JSON.stringify({ source: sentinel, nested: { payload: sentinel } }), ontology.ontologyId, ontology.version, ontology.contentHash, "[]", "[]", "[]", "operator", new Date().toISOString());
    db.pragma("user_version = 23");
    const { initSchema } = await import("@/lib/db-schema");
    initSchema(db);
    const stored = db.prepare(`SELECT provenance_summary_json FROM ontology_packs WHERE id = 'legacy-pack'`).get() as { provenance_summary_json: string };
    expect(stored.provenance_summary_json).toBe("{}");
    expect(JSON.stringify(mod.getDomainPack(db, "legacy-pack"))).not.toContain(sentinel);
  });

  it("makes published ontology rows immutable in SQLite while preserving successor publication and registry pointers", async () => {
    const { mod, ontology } = await canonical();
    const original = JSON.stringify(mod.discoverOntology(db));
    expect(() => db.prepare(`UPDATE ontology_versions SET content_hash = ? WHERE ontology_id = ? AND version = ?`)
      .run(SOURCE_HASH, ontology.ontologyId, ontology.version)).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM ontology_versions WHERE ontology_id = ? AND version = ?`)
      .run(ontology.ontologyId, ontology.version)).toThrow(/immutable/);
    expect(JSON.stringify(mod.discoverOntology(db))).toBe(original);
    const successor = nextDocument(mod, ontology);
    const successorHash = mod.canonicalContentHash(successor);
    const published = mod.publishOntologyVersion(db, {
      ...successor, actor: "operator", suppliedHash: successorHash,
      projections: mod.ONTOLOGY_PROJECTIONS.map((projection) => ({ projection, contentHash: successorHash })),
    });
    expect(published.version).toBe("1.1.0");
    expect(mod.discoverOntology(db).version).toBe("1.1.0");
  });

  it("fails pack registration atomically when its required audit evidence cannot persist", async () => {
    const { mod, ontology } = await canonical();
    db.exec(`
      CREATE TRIGGER reject_pack_audit
      BEFORE INSERT ON audit_entries
      WHEN NEW.event_type = 'ontology_pack_registered'
      BEGIN SELECT RAISE(ABORT, 'audit rejection'); END;
    `);
    expect(() => mod.registerDomainPack(db, {
      namespace: "atomic", owner: "ops", version: "1.0.0", sourceHash: SOURCE_HASH,
      provenanceSummary: { sourceId: "src_atomic", classification: "internal", importedAt: "2026-07-12T00:00:00Z", references: ["ref_atomic"] },
      ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
      types: [packType(ontology, "atomic.record")],
      actor: "operator",
    })).toThrow(/audit/);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM ontology_packs WHERE namespace = 'atomic'`).get()).toMatchObject({ count: 0 });
  });

  it("VAL-ONTO-007 validates pack dependencies, fully qualified type collisions, and dependency cycles", async () => {
    const { mod, ontology } = await canonical();
    const base = mod.registerDomainPack(db, {
      id: "base", namespace: "base", owner: "ops", version: "1.0.0", sourceHash: SOURCE_HASH, provenanceSummary: { sourceId: "src_base", classification: "internal", importedAt: "2026-07-12T00:00:00Z", references: ["ref_base"] },
      ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
      types: [packType(ontology, "base.record", { aliases: ["base.record-alias"] })], actor: "operator",
    });
    mod.transitionDomainPack(db, { packId: base.id, toState: "approved", actor: "operator" });
    const packCountBeforeCoreImpersonation = db.prepare(`SELECT COUNT(*) AS count FROM ontology_packs`).get() as { count: number };
    const auditCountBeforeCoreImpersonation = db.prepare(`SELECT COUNT(*) AS count FROM audit_entries WHERE event_type = 'ontology_pack_registered'`).get() as { count: number };
    expect(() => mod.registerDomainPack(db, {
      namespace: "core-impersonating-type", owner: "ops", version: "1.0.0", sourceHash: SOURCE_HASH,
      provenanceSummary: { sourceId: "src_core_impersonating_type", classification: "internal", importedAt: "2026-07-12T00:00:00Z", references: ["ref_core_impersonating_type"] },
      ontology: base.ontology,
      types: [{
        id: "core-impersonating-type.child",
        semantics: {},
        extends: { kind: "core", id: "base.record", ontologyId: base.ontology.id, ontologyVersion: base.ontology.version, ontologyContentHash: base.ontology.contentHash },
      }],
      actor: "operator",
    })).toThrow(/exact parent ontology coordinates/);
    expect(() => mod.registerDomainPack(db, {
      namespace: "core-impersonating-alias", owner: "ops", version: "1.0.0", sourceHash: SOURCE_HASH,
      provenanceSummary: { sourceId: "src_core_impersonating_alias", classification: "internal", importedAt: "2026-07-12T00:00:00Z", references: ["ref_core_impersonating_alias"] },
      ontology: base.ontology,
      dependencies: [{ namespace: "base", version: "1.0.0", sourceHash: SOURCE_HASH }],
      types: [{
        id: "core-impersonating-alias.child",
        semantics: {},
        extends: { kind: "core", id: "base.record-alias", ontologyId: base.ontology.id, ontologyVersion: base.ontology.version, ontologyContentHash: base.ontology.contentHash },
      }],
      actor: "operator",
    })).toThrow(/exact parent ontology coordinates/);
    expect(() => mod.registerDomainPack(db, {
      namespace: "core-alias", owner: "ops", version: "1.0.0", sourceHash: SOURCE_HASH,
      provenanceSummary: { sourceId: "src_core_alias", classification: "internal", importedAt: "2026-07-12T00:00:00Z", references: ["ref_core_alias"] },
      ontology: base.ontology,
      types: [{
        id: "core-alias.child",
        semantics: {},
        extends: { kind: "core", id: "thing", ontologyId: base.ontology.id, ontologyVersion: base.ontology.version, ontologyContentHash: base.ontology.contentHash },
      }],
      actor: "operator",
    })).toThrow(/exact parent ontology coordinates/);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM ontology_packs`).get()).toEqual(packCountBeforeCoreImpersonation);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM audit_entries WHERE event_type = 'ontology_pack_registered'`).get()).toEqual(auditCountBeforeCoreImpersonation);
    expect(() => mod.registerDomainPack(db, {
      namespace: "invalid.extension", owner: "ops", version: "1.0.0", sourceHash: SOURCE_HASH,
      provenanceSummary: { sourceId: "src_invalid_extension", classification: "internal", importedAt: "2026-07-12T00:00:00Z", references: ["ref_invalid_extension"] },
      ontology: base.ontology,
      dependencies: [{ namespace: "base", version: "1.0.0", sourceHash: SOURCE_HASH }],
      types: [{
        id: "invalid.extension.child",
        semantics: {},
        extends: { kind: "dependency", id: "base.missing", namespace: "base", version: "1.0.0", sourceHash: SOURCE_HASH },
      }],
      relationships: [{ from: "invalid.extension.child", to: "base.missing", type: "is_a" }],
      actor: "operator",
    })).toThrow(/exact dependency coordinate/);
    const child = mod.registerDomainPack(db, {
      namespace: "compatible", owner: "ops", version: "1.0.0", sourceHash: SOURCE_HASH,
      provenanceSummary: { sourceId: "src_compatible", classification: "internal", importedAt: "2026-07-12T00:00:00Z", references: ["ref_compatible"] },
      ontology: base.ontology,
      dependencies: [{ namespace: "base", version: "1.0.0", sourceHash: SOURCE_HASH }],
      types: [{
        id: "compatible.child",
        semantics: {},
        extends: { kind: "dependency", id: "base.record-alias", namespace: "base", version: "1.0.0", sourceHash: SOURCE_HASH },
      }],
      relationships: [{ from: "compatible.child", to: "base.record-alias", type: "is_a" }],
      actor: "operator",
    });
    expect(child.relationships).toEqual([{ from: "compatible.child", to: "base.record-alias", type: "is_a" }]);
    expect(() => mod.registerDomainPack(db, {
      namespace: "child", owner: "ops", version: "1.0.0", sourceHash: SOURCE_HASH, provenanceSummary: { sourceId: "src_child", classification: "internal", importedAt: "2026-07-12T00:00:00Z", references: ["ref_child"] }, ontology: base.ontology,
      dependencies: [{ namespace: "base", version: "1.0.0", sourceHash: `sha256:${"b".repeat(64)}` }],
      types: [packType(base.ontology, "child.record")], actor: "operator",
    })).toThrow(/source hash is stale/);
    expect(() => mod.registerDomainPack(db, {
      namespace: "missing", owner: "ops", version: "1.0.0", sourceHash: SOURCE_HASH, provenanceSummary: { sourceId: "src_missing", classification: "internal", importedAt: "2026-07-12T00:00:00Z", references: ["ref_missing"] }, ontology: base.ontology,
      dependencies: [{ namespace: "absent", version: "1.0.0", sourceHash: SOURCE_HASH }],
      types: [packType(base.ontology, "missing.record")], actor: "operator",
    })).toThrow(/does not exist/);
    expect(() => mod.registerDomainPack(db, {
      namespace: "self", owner: "ops", version: "1.0.0", sourceHash: SOURCE_HASH, provenanceSummary: { sourceId: "src_self", classification: "internal", importedAt: "2026-07-12T00:00:00Z", references: ["ref_self"] }, ontology: base.ontology,
      dependencies: [{ namespace: "self", version: "1.0.0", sourceHash: SOURCE_HASH }],
      types: [packType(base.ontology, "self.record")], actor: "operator",
    })).toThrow(/cannot depend on itself/);
    mod.transitionDomainPack(db, { packId: base.id, toState: "deprecated", actor: "operator", reason: "stale" });
    expect(() => mod.registerDomainPack(db, {
      namespace: "deprecated", owner: "ops", version: "1.0.0", sourceHash: SOURCE_HASH, provenanceSummary: { sourceId: "src_deprecated", classification: "internal", importedAt: "2026-07-12T00:00:00Z", references: ["ref_deprecated"] }, ontology: base.ontology,
      dependencies: [{ namespace: "base", version: "1.0.0", sourceHash: SOURCE_HASH }],
      types: [packType(base.ontology, "deprecated.record")], actor: "operator",
    })).toThrow(/found deprecated/);
    db.prepare(`UPDATE ontology_packs SET lifecycle_state = 'approved' WHERE id = ?`).run(base.id);
    expect(() => mod.registerDomainPack(db, {
      namespace: "child", owner: "ops", version: "1.0.0", sourceHash: SOURCE_HASH, provenanceSummary: { sourceId: "src_shadow", classification: "internal", importedAt: "2026-07-12T00:00:00Z", references: ["ref_shadow"] }, ontology: base.ontology,
      types: [packType(base.ontology, "entity")], actor: "operator",
    })).toThrow(/namespace-qualified/);
    db.prepare(`INSERT INTO ontology_packs (id, namespace, owner, version, source_hash, provenance_summary_json, ontology_id, ontology_version, ontology_content_hash, types_json, dependencies_json, lifecycle_state, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)`)
      .run("cycle-existing", "cycle.existing", "ops", "1.0.0", SOURCE_HASH, "{}", base.ontology.id, base.ontology.version, base.ontology.contentHash, "[]", JSON.stringify([{ namespace: "cycle.future", version: "1.0.0", sourceHash: SOURCE_HASH }]), "operator", new Date().toISOString());
    expect(() => mod.registerDomainPack(db, {
      id: "cycle-future", namespace: "cycle.future", owner: "ops", version: "1.0.0", sourceHash: SOURCE_HASH, provenanceSummary: { sourceId: "src_cycle", classification: "internal", importedAt: "2026-07-12T00:00:00Z", references: ["ref_cycle"] }, ontology: base.ontology,
      dependencies: [{ namespace: "cycle.existing", version: "1.0.0", sourceHash: SOURCE_HASH }],
      types: [packType(base.ontology, "cycle.future.record")], actor: "operator",
    })).toThrow(/cycle/);
  });

  it("VAL-ONTO-010 rejects types and aliases that shadow existing domain packs across namespaces", async () => {
    const { mod, ontology } = await canonical();
    const existing = mod.registerDomainPack(db, {
      namespace: "finance", owner: "ops", version: "1.0.0", sourceHash: SOURCE_HASH, provenanceSummary: { sourceId: "src_finance", classification: "internal", importedAt: "2026-07-12T00:00:00Z", references: ["ref_finance"] },
      ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
      types: [packType(ontology, "finance.invoice", { aliases: ["finance.case", "finance.invoice-alias"] })], actor: "operator",
    });
    expect(() => mod.registerDomainPack(db, {
      namespace: "legal", owner: "ops", version: "1.0.0", sourceHash: SOURCE_HASH, provenanceSummary: { sourceId: "src_legal", classification: "internal", importedAt: "2026-07-12T00:00:00Z", references: ["ref_legal"] }, ontology: existing.ontology,
      types: [packType(existing.ontology, "legal.case", { aliases: ["finance.case"] })], actor: "operator",
    })).toThrow(/existing definition or alias/);
    expect(() => mod.registerDomainPack(db, {
      namespace: "legal", owner: "ops", version: "1.0.1", sourceHash: SOURCE_HASH, provenanceSummary: { sourceId: "src_legal2", classification: "internal", importedAt: "2026-07-12T00:00:00Z", references: ["ref_legal2"] }, ontology: existing.ontology,
      types: [packType(existing.ontology, "legal.record", { aliases: ["finance.invoice"] })], actor: "operator",
    })).toThrow(/existing definition or alias/);
    expect(() => mod.registerDomainPack(db, {
      namespace: "legal", owner: "ops", version: "1.0.2", sourceHash: SOURCE_HASH, provenanceSummary: { sourceId: "src_legal3", classification: "internal", importedAt: "2026-07-12T00:00:00Z", references: ["ref_legal3"] }, ontology: existing.ontology,
      types: [packType(existing.ontology, "legal.invoice", { aliases: ["finance.invoice-alias"] })], actor: "operator",
    })).toThrow(/existing definition or alias/);
  });

  it("VAL-ONTO-008 enforces pack lifecycle transitions, authoritative write eligibility, and historical readability", async () => {
    const { mod, ontology } = await canonical();
    const replacement = mod.registerDomainPack(db, {
      namespace: "replacement", owner: "ops", version: "1.0.0", sourceHash: SOURCE_HASH, provenanceSummary: { sourceId: "src_replacement", classification: "internal", importedAt: "2026-07-12T00:00:00Z", references: ["ref_replacement"] }, ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
      types: [packType(ontology, "replacement.record")], actor: "operator",
    });
    const pack = mod.registerDomainPack(db, {
      namespace: "lifecycle", owner: "ops", version: "1.0.0", sourceHash: SOURCE_HASH, provenanceSummary: { sourceId: "src_lifecycle", classification: "internal", importedAt: "2026-07-12T00:00:00Z", references: ["ref_lifecycle"] }, ontology: replacement.ontology,
      types: [packType(replacement.ontology, "lifecycle.record")], actor: "operator",
    });
    expect(() => mod.assertPackAuthoritative(db, pack.id)).toThrow(/not approved/);
    mod.transitionDomainPack(db, { packId: replacement.id, toState: "approved", actor: "operator" });
    mod.transitionDomainPack(db, { packId: pack.id, toState: "approved", actor: "operator" });
    expect(mod.assertPackAuthoritative(db, pack.id).id).toBe(pack.id);
    expect(() => mod.transitionDomainPack(db, { packId: pack.id, toState: "deprecated", actor: "operator" })).toThrow(/reason/);
    mod.transitionDomainPack(db, { packId: pack.id, toState: "deprecated", actor: "operator", reason: "replaced" });
    expect(mod.getDomainPack(db, pack.id)?.lifecycleState).toBe("deprecated");
    expect(() => mod.assertPackAuthoritative(db, pack.id)).toThrow(/not approved/);
    expect(() => mod.transitionDomainPack(db, { packId: pack.id, toState: "retired", actor: "operator" })).toThrow(/replacement/);
    const retired = mod.transitionDomainPack(db, { packId: pack.id, toState: "retired", actor: "operator", replacementPackId: replacement.id });
    expect(retired.lifecycleState).toBe("retired");
  });

  it("rejects pack relationship mismatches, duplicate relationships, and invalid coordinates", async () => {
    const { mod, ontology } = await canonical();
    const base = mod.registerDomainPack(db, {
      namespace: "rel.base", owner: "ops", version: "1.0.0", sourceHash: SOURCE_HASH,
      provenanceSummary: { sourceId: "src_rel_base", classification: "internal", importedAt: "2026-07-12T00:00:00Z", references: ["ref_rel_base"] },
      ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
      types: [packType(ontology, "rel.base.record")], actor: "operator",
    });
    mod.transitionDomainPack(db, { packId: base.id, toState: "approved", actor: "operator" });

    expect(() => mod.registerDomainPack(db, {
      namespace: "rel.bad-parent", owner: "ops", version: "1.0.0", sourceHash: SOURCE_HASH,
      provenanceSummary: { sourceId: "src_rel_bad_parent", classification: "internal", importedAt: "2026-07-12T00:00:00Z", references: ["ref_rel_bad_parent"] },
      ontology: base.ontology,
      types: [packType(ontology, "rel.bad-parent.child")],
      relationships: [{ from: "rel.bad-parent.child", to: "person", type: "is_a" }],
      actor: "operator",
    })).toThrow(/preserve the declared inherited parent/);

    expect(() => mod.registerDomainPack(db, {
      namespace: "rel.duplicate", owner: "ops", version: "1.0.0", sourceHash: SOURCE_HASH,
      provenanceSummary: { sourceId: "src_rel_duplicate", classification: "internal", importedAt: "2026-07-12T00:00:00Z", references: ["ref_rel_duplicate"] },
      ontology: base.ontology,
      types: [packType(ontology, "rel.duplicate.child")],
      relationships: [
        { from: "rel.duplicate.child", to: "entity", type: "is_a" },
        { from: "rel.duplicate.child", to: "entity", type: "is_a" },
      ],
      actor: "operator",
    })).toThrow(/Duplicate pack relationship/);

    expect(() => mod.registerDomainPack(db, {
      namespace: "rel.missing", owner: "ops", version: "1.0.0", sourceHash: SOURCE_HASH,
      provenanceSummary: { sourceId: "src_rel_missing", classification: "internal", importedAt: "2026-07-12T00:00:00Z", references: ["ref_rel_missing"] },
      ontology: base.ontology,
      types: [packType(ontology, "rel.missing.child")],
      relationships: [],
      actor: "operator",
    })).toThrow(/preserve its inherited is_a relationship/);

    expect(() => mod.registerDomainPack(db, {
      namespace: "coords.bad", owner: "ops", version: "1.0.0", sourceHash: SOURCE_HASH,
      provenanceSummary: { sourceId: "src_coords_bad", classification: "internal", importedAt: "2026-07-12T00:00:00Z", references: ["ref_coords_bad"] },
      ontology: null as never,
      types: [packType(ontology, "coords.bad.child")],
      actor: "operator",
    })).toThrow(/ontology coordinates are required/);

    expect(() => mod.registerDomainPack(db, {
      namespace: "deps.bad", owner: "ops", version: "1.0.0", sourceHash: SOURCE_HASH,
      provenanceSummary: { sourceId: "src_deps_bad", classification: "internal", importedAt: "2026-07-12T00:00:00Z", references: ["ref_deps_bad"] },
      ontology: base.ontology,
      dependencies: ["not-an-object"] as never,
      types: [packType(ontology, "deps.bad.child")],
      actor: "operator",
    })).toThrow(/dependency is invalid/);
  });

  it("rejects invalid pack aliases and malformed relationship objects", async () => {
    const { mod, ontology } = await canonical();
    const base = mod.registerDomainPack(db, {
      namespace: "alias.base",
      owner: "ops",
      version: "1.0.0",
      sourceHash: SOURCE_HASH,
      provenanceSummary: {
        sourceId: "src_alias_base",
        classification: "internal",
        importedAt: "2026-07-12T00:00:00Z",
        references: ["ref_alias_base"],
      },
      ontology: { id: ontology.ontologyId, version: ontology.version, contentHash: ontology.contentHash },
      types: [packType(ontology, "alias.base.record")],
      actor: "operator",
    });
    mod.transitionDomainPack(db, { packId: base.id, toState: "approved", actor: "operator" });

    expect(() =>
      mod.registerDomainPack(db, {
        namespace: "alias.bad",
        owner: "ops",
        version: "1.0.0",
        sourceHash: SOURCE_HASH,
        provenanceSummary: {
          sourceId: "src_alias_bad",
          classification: "internal",
          importedAt: "2026-07-12T00:00:00Z",
          references: ["ref_alias_bad"],
        },
        ontology: base.ontology,
        types: [
          {
            ...packType(ontology, "alias.bad.child"),
            aliases: ["not-a-valid-alias!!!"],
          },
        ],
        actor: "operator",
      })
    ).toThrow(/Pack alias must use a valid namespace-qualified identifier/);

    expect(() =>
      mod.registerDomainPack(db, {
        namespace: "alias.rel",
        owner: "ops",
        version: "1.0.0",
        sourceHash: SOURCE_HASH,
        provenanceSummary: {
          sourceId: "src_alias_rel",
          classification: "internal",
          importedAt: "2026-07-12T00:00:00Z",
          references: ["ref_alias_rel"],
        },
        ontology: base.ontology,
        types: [packType(ontology, "alias.rel.child")],
        relationships: [{ from: "alias.rel.child", to: 123 as unknown as string, type: "is_a" }],
        actor: "operator",
      })
    ).toThrow(/Pack relationship is invalid/);
  });

  it("VAL-ONTO-009 rolls back ontology publication when its paired audit row fails", async () => {
    const { mod, ontology } = await canonical();
    db.exec(`
      CREATE TRIGGER reject_ontology_audit
      BEFORE INSERT ON audit_entries
      WHEN NEW.event_type = 'ontology_version_published'
      BEGIN SELECT RAISE(ABORT, 'audit rejection'); END;
    `);
    const document = nextDocument(mod, ontology);
    const hash = mod.canonicalContentHash(document);
    expect(() => mod.publishOntologyVersion(db, {
      ...document, actor: "operator", suppliedHash: hash,
      projections: mod.ONTOLOGY_PROJECTIONS.map((projection) => ({ projection, contentHash: hash })),
    })).toThrow(/audit/);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM ontology_versions WHERE version = '1.1.0'`).get()).toMatchObject({ count: 0 });
    expect(mod.discoverOntology(db).version).toBe("1.0.0");
  });
});
