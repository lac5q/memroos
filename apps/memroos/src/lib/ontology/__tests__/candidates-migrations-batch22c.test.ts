// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = path.join(os.tmpdir(), `ontology-b22c-${crypto.randomUUID()}`);
const SOURCE_HASH = `sha256:${"e".repeat(64)}`;

let db: import("better-sqlite3").Database;
let closeDb: () => void;

beforeEach(async () => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  process.env.MEMROOS_ROOT = TMP_ROOT;
  process.env.SQLITE_DB_PATH = path.join(TMP_ROOT, `ontology-${crypto.randomUUID()}.db`);
  vi.resetModules();
  const database = await import("@/lib/db");
  db = database.getDb();
  closeDb = database.closeDb;
  const { initSchema } = await import("@/lib/db-schema");
  initSchema(db);
  db.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-a', 'Tenant A')").run();
});

afterEach(() => {
  closeDb?.();
  delete process.env.MEMROOS_ROOT;
  delete process.env.SQLITE_DB_PATH;
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

async function seedInventoryPlan() {
  const registry = await import("../registry");
  const migrations = await import("../migrations");
  const ontology = registry.ensureCanonicalUpperOntology(db, "operator");
  const document = {
    id: ontology.ontologyId,
    version: "1.2.0",
    definitions: [...registry.CORE_VOCABULARY, { id: "migration.target", semantics: { kind: "entity" } }],
    relationships: [...registry.CORE_RELATIONSHIPS, { from: "migration.target", to: "entity", type: "is_a" }],
    parent: ontology,
  };
  const hash = registry.canonicalContentHash(document);
  const target = registry.publishOntologyVersion(db, {
    ...document,
    actor: "operator",
    suppliedHash: hash,
    projections: registry.ONTOLOGY_PROJECTIONS.map((projection) => ({ projection, contentHash: hash })),
  });
  const sourceLifecycleHash = `sha256:${"f".repeat(64)}`;
  const sourceId = "source:legacy:record-b22c";
  const recordId = `vr-b22c-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO ontology_versioned_records
      (id, tenant_id, space_id, record_type, record_id, qualified_type, ontology_id, ontology_version, ontology_content_hash, legacy_type, mapping_path_json, created_at, source_id, source_hash)
     VALUES (?, 'tenant-a', 'space-a', 'knowledge', 'record-b22c', 'legacy', ?, ?, ?, 'legacy', '[]', ?, ?, ?)`,
  ).run(recordId, ontology.ontologyId, ontology.version, ontology.contentHash, new Date().toISOString(), sourceId, sourceLifecycleHash);
  db.prepare(
    `INSERT INTO ontology_source_lifecycle (tenant_id, space_id, source_id, source_hash, status, updated_at, updated_by, reason_code)
     VALUES ('tenant-a', 'space-a', ?, ?, 'active', ?, 'operator', 'test')`,
  ).run(sourceId, sourceLifecycleHash, new Date().toISOString());
  db.prepare(
    `INSERT INTO ontology_derivative_validity (id, tenant_id, space_id, source_id, source_hash, derivative_type, derivative_id, status, created_at)
     VALUES (?, 'tenant-a', 'space-a', ?, ?, 'versioned_record', ?, 'authoritative', ?)`,
  ).run(`valid:${recordId}`, sourceId, sourceLifecycleHash, recordId, new Date().toISOString());
  const plan = migrations.planOntologyMigration(db, {
    tenantId: "tenant-a",
    spaceId: "space-a",
    source: { ontologyId: ontology.ontologyId, version: ontology.version, hash: ontology.contentHash },
    target: { ontologyId: target.ontologyId, version: target.version, hash: target.contentHash },
    mappings: { legacy: ["migration.target"] },
    actor: "operator",
  });
  return { migrations, plan, target, ontology, recordId, sourceLifecycleHash };
}

describe("ontology candidates + migrations batch22c", () => {
  it("extractOntologyCandidate rejects invalid provenance tags and malformed proposed payloads", async () => {
    const candidates = await import("../candidates");
    const registry = await import("../registry");
    registry.ensureCanonicalUpperOntology(db, "operator");
    const base = {
      tenantId: "tenant-a",
      spaceId: "space-a",
      sourceId: "source:cand-b22c",
      sourceHash: SOURCE_HASH,
      sourceSpans: ["span-1"],
      extractorId: "extractor-b22c",
      extractorVersion: "1.0.0",
      candidateKind: "type" as const,
      namespace: "batch22c",
      proposed: { id: "batch22c.example", semantics: { kind: "entity" } },
      confidenceLabel: "high" as const,
      confidenceScore: 0.9,
      actor: "operator",
    };
    expect(() =>
      candidates.extractOntologyCandidate(db, { ...base, provenanceTag: "HALLUCINATED" as never }),
    ).toThrow(/provenance tag must be EXTRACTED/i);
    expect(() =>
      candidates.extractOntologyCandidate(db, { ...base, proposed: [] as never }),
    ).toThrow(/proposed candidate is required/i);
  });

  it("planOntologyMigration returns existing plan hash and rejects malformed mappings", async () => {
    const { migrations, plan } = await seedInventoryPlan();
    const again = migrations.planOntologyMigration(db, {
      tenantId: "tenant-a",
      spaceId: "space-a",
      source: plan.source,
      target: plan.target,
      mappings: plan.mappings,
      actor: "operator",
    });
    expect(again.id).toBe(plan.id);
    expect(() =>
      migrations.planOntologyMigration(db, {
        tenantId: "tenant-a",
        spaceId: "space-a",
        source: plan.source,
        target: plan.target,
        mappings: { legacy: ["NOT_A_REAL_TARGET_TYPE"] },
        actor: "operator",
      }),
    ).toThrow(/malformed or unsupported/i);
  });

  it("approveOntologyMigration and executeOntologyMigration enforce snapshot integrity", async () => {
    const { migrations, plan, target, recordId, sourceLifecycleHash } = await seedInventoryPlan();
    expect(() =>
      migrations.executeOntologyMigration(db, {
        planId: plan.id,
        tenantId: "tenant-a",
        spaceId: "space-a",
        actor: "operator",
      }),
    ).toThrow(/must be approved before execution/i);

    const replan = migrations.planOntologyMigration(db, {
      tenantId: "tenant-a",
      spaceId: "space-a",
      source: plan.source,
      target: plan.target,
      mappings: plan.mappings,
      actor: "operator",
    });
    migrations.approveOntologyMigration(db, {
      planId: replan.id,
      tenantId: "tenant-a",
      spaceId: "space-a",
      planHash: replan.planHash,
      actor: "operator",
    });
    db.prepare(`UPDATE ontology_versioned_records SET source_hash = ? WHERE id = ?`).run(
      `sha256:${"0".repeat(64)}`,
      recordId,
    );
    expect(() =>
      migrations.executeOntologyMigration(db, {
        planId: replan.id,
        tenantId: "tenant-a",
        spaceId: "space-a",
        actor: "operator",
      }),
    ).toThrow(/snapshot source is stale/i);

    db.prepare(`UPDATE ontology_versioned_records SET source_hash = ? WHERE id = ?`).run(sourceLifecycleHash, recordId);
  });

  it("executeOntologyMigration rejects conflicting target versioned records", async () => {
    const { migrations, plan, target, sourceLifecycleHash } = await seedInventoryPlan();
    db.prepare(
      `INSERT INTO ontology_versioned_records
        (id, tenant_id, space_id, record_type, record_id, qualified_type, ontology_id, ontology_version, ontology_content_hash, legacy_type, mapping_path_json, created_at, source_id, source_hash)
       VALUES ('conflict-vr', 'tenant-a', 'space-a', 'knowledge', 'record-b22c', 'migration.target', ?, ?, ?, 'legacy', '[]', ?, ?, ?)`,
    ).run(target.ontologyId, target.version, target.contentHash, new Date().toISOString(), "source:legacy:record-b22c", sourceLifecycleHash);
    const execPlan = migrations.planOntologyMigration(db, {
      tenantId: "tenant-a",
      spaceId: "space-a",
      source: plan.source,
      target: plan.target,
      mappings: plan.mappings,
      actor: "operator",
    });
    if (execPlan.status === "planned") {
      migrations.approveOntologyMigration(db, {
        planId: execPlan.id,
        tenantId: "tenant-a",
        spaceId: "space-a",
        planHash: execPlan.planHash,
        actor: "operator",
      });
    }
    expect(() =>
      migrations.executeOntologyMigration(db, {
        planId: execPlan.id,
        tenantId: "tenant-a",
        spaceId: "space-a",
        actor: "operator",
      }),
    ).toThrow(/not bound to this migration snapshot/i);
  });
});
