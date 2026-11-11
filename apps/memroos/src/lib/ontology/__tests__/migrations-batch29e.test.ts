// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = path.join(os.tmpdir(), `ontology-mig-b29e-${crypto.randomUUID()}`);

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
  db.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-b29e', 'Tenant B29E')").run();
});

afterEach(() => {
  closeDb?.();
  delete process.env.MEMROOS_ROOT;
  delete process.env.SQLITE_DB_PATH;
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function seedInventoryPlan() {
  const registry = await import("../registry");
  const migrations = await import("../migrations");
  const ontology = registry.ensureCanonicalUpperOntology(db, "operator");
  const document = {
    id: ontology.ontologyId,
    version: "1.2.0",
    definitions: [...registry.CORE_VOCABULARY, { id: "migration.target.b29e", semantics: { kind: "entity" } }],
    relationships: [...registry.CORE_RELATIONSHIPS, { from: "migration.target.b29e", to: "entity", type: "is_a" }],
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
  const sourceId = "source:legacy:record-b29e";
  const recordId = `vr-b29e-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO ontology_versioned_records
      (id, tenant_id, space_id, record_type, record_id, qualified_type, ontology_id, ontology_version, ontology_content_hash, legacy_type, mapping_path_json, created_at, source_id, source_hash)
     VALUES (?, 'tenant-b29e', 'space-b29e', 'knowledge', 'record-b29e', 'legacy', ?, ?, ?, 'legacy', '[]', ?, ?, ?)`,
  ).run(recordId, ontology.ontologyId, ontology.version, ontology.contentHash, new Date().toISOString(), sourceId, sourceLifecycleHash);
  db.prepare(
    `INSERT INTO ontology_source_lifecycle (tenant_id, space_id, source_id, source_hash, status, updated_at, updated_by, reason_code)
     VALUES ('tenant-b29e', 'space-b29e', ?, ?, 'active', ?, 'operator', 'test')`,
  ).run(sourceId, sourceLifecycleHash, new Date().toISOString());
  db.prepare(
    `INSERT INTO ontology_derivative_validity (id, tenant_id, space_id, source_id, source_hash, derivative_type, derivative_id, status, created_at)
     VALUES (?, 'tenant-b29e', 'space-b29e', ?, ?, 'versioned_record', ?, 'authoritative', ?)`,
  ).run(`valid:${recordId}`, sourceId, sourceLifecycleHash, recordId, new Date().toISOString());
  const plan = migrations.planOntologyMigration(db, {
    tenantId: "tenant-b29e",
    spaceId: "space-b29e",
    source: { ontologyId: ontology.ontologyId, version: ontology.version, hash: ontology.contentHash },
    target: { ontologyId: target.ontologyId, version: target.version, hash: target.contentHash },
    mappings: { legacy: ["migration.target.b29e"] },
    actor: "operator",
  });
  return { migrations, plan, target, ontology, recordId, sourceLifecycleHash };
}

describe("ontology migrations batch29e — snapshot loadSnapshot + integrity", () => {
  it("loadSnapshot throws when snapshot row is missing (line 67)", async () => {
    const { migrations, plan } = await seedInventoryPlan();
    db.exec(`DROP TRIGGER IF EXISTS ontology_migration_snapshots_no_delete`);
    db.exec(`DROP TRIGGER IF EXISTS ontology_migration_snapshot_items_no_delete`);
    db.prepare(`DELETE FROM ontology_migration_snapshot_items WHERE snapshot_id = ?`).run(plan.snapshot.id);
    db.prepare(`DELETE FROM ontology_migration_snapshots WHERE plan_id = ?`).run(plan.id);
    expect(() =>
      migrations.approveOntologyMigration(db, {
        planId: plan.id,
        tenantId: "tenant-b29e",
        spaceId: "space-b29e",
        planHash: plan.planHash,
        actor: "operator",
      }),
    ).toThrow(/snapshot is unavailable/i);
  });

  it("loadSnapshotItems rejects tampered inventory hash (line 176)", async () => {
    const { migrations, plan } = await seedInventoryPlan();
    db.exec(`DROP TRIGGER IF EXISTS ontology_migration_snapshots_no_update`);
    db.prepare(`UPDATE ontology_migration_snapshots SET inventory_hash = ? WHERE plan_id = ?`).run(
      `sha256:${"0".repeat(64)}`,
      plan.id,
    );
    expect(() =>
      migrations.approveOntologyMigration(db, {
        planId: plan.id,
        tenantId: "tenant-b29e",
        spaceId: "space-b29e",
        planHash: plan.planHash,
        actor: "operator",
      }),
    ).toThrow(/integrity is unavailable/i);
  });

  it("planOntologyMigration rejects null mappings (line 239)", async () => {
    const registry = await import("../registry");
    const migrations = await import("../migrations");
    const ontology = registry.ensureCanonicalUpperOntology(db, "operator");
    expect(() =>
      migrations.planOntologyMigration(db, {
        tenantId: "tenant-b29e",
        spaceId: "space-empty-b29e",
        source: { ontologyId: ontology.ontologyId, version: ontology.version, hash: ontology.contentHash },
        target: { ontologyId: ontology.ontologyId, version: ontology.version, hash: ontology.contentHash },
        mappings: null as unknown as Record<string, string[]>,
        actor: "operator",
      }),
    ).toThrow(/unavailable/i);
  });
});
