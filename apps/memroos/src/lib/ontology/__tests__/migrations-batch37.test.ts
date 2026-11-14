// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = path.join(os.tmpdir(), `ontology-mig-b37-${crypto.randomUUID()}`);

let db: import("better-sqlite3").Database;
let closeDb: () => void;

beforeEach(async () => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  process.env.MEMROOS_ROOT = TMP_ROOT;
  process.env.SQLITE_DB_PATH = path.join(TMP_ROOT, `ontology-b37-${crypto.randomUUID()}.db`);
  vi.resetModules();
  const database = await import("@/lib/db");
  db = database.getDb();
  closeDb = database.closeDb;
  const { initSchema } = await import("@/lib/db-schema");
  initSchema(db);
  db.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-b37', 'Tenant B37')").run();
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
    version: "1.2.0-b37",
    definitions: [...registry.CORE_VOCABULARY, { id: "migration.target.b37", semantics: { kind: "entity" } }],
    relationships: [...registry.CORE_RELATIONSHIPS, { from: "migration.target.b37", to: "entity", type: "is_a" }],
    parent: ontology,
  };
  const hash = registry.canonicalContentHash(document);
  const target = registry.publishOntologyVersion(db, {
    ...document,
    actor: "operator",
    suppliedHash: hash,
    projections: registry.ONTOLOGY_PROJECTIONS.map((projection) => ({ projection, contentHash: hash })),
  });
  const sourceLifecycleHash = `sha256:${"a".repeat(64)}`;
  const sourceId = "source:legacy:record-b37";
  const recordId = `vr-b37-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO ontology_versioned_records
      (id, tenant_id, space_id, record_type, record_id, qualified_type, ontology_id, ontology_version, ontology_content_hash, legacy_type, mapping_path_json, created_at, source_id, source_hash)
     VALUES (?, 'tenant-b37', 'space-b37', 'knowledge', 'record-b37', 'legacy', ?, ?, ?, 'legacy', '[]', ?, ?, ?)`,
  ).run(recordId, ontology.ontologyId, ontology.version, ontology.contentHash, new Date().toISOString(), sourceId, sourceLifecycleHash);
  db.prepare(
    `INSERT INTO ontology_source_lifecycle (tenant_id, space_id, source_id, source_hash, status, updated_at, updated_by, reason_code)
     VALUES ('tenant-b37', 'space-b37', ?, ?, 'active', ?, 'operator', 'test')`,
  ).run(sourceId, sourceLifecycleHash, new Date().toISOString());
  db.prepare(
    `INSERT INTO ontology_derivative_validity (id, tenant_id, space_id, source_id, source_hash, derivative_type, derivative_id, status, created_at)
     VALUES (?, 'tenant-b37', 'space-b37', ?, ?, 'versioned_record', ?, 'authoritative', ?)`,
  ).run(`valid:${recordId}`, sourceId, sourceLifecycleHash, recordId, new Date().toISOString());
  const plan = migrations.planOntologyMigration(db, {
    tenantId: "tenant-b37",
    spaceId: "space-b37",
    source: { ontologyId: ontology.ontologyId, version: ontology.version, hash: ontology.contentHash },
    target: { ontologyId: target.ontologyId, version: target.version, hash: target.contentHash },
    mappings: { legacy: ["migration.target.b37"] },
    actor: "operator",
  });
  return { migrations, plan };
}

describe("ontology migrations batch37", () => {
  it("loadSnapshotItems rejects scope binding drift on snapshot items (184)", async () => {
    const { migrations, plan } = await seedInventoryPlan();
    db.exec(`DROP TRIGGER IF EXISTS ontology_migration_snapshot_items_no_update`);
    db.prepare(`UPDATE ontology_migration_snapshot_items SET tenant_id = ? WHERE snapshot_id = ?`).run(
      "other-tenant-b37",
      plan.snapshot.id,
    );
    expect(() =>
      migrations.approveOntologyMigration(db, {
        planId: plan.id,
        tenantId: "tenant-b37",
        spaceId: "space-b37",
        planHash: plan.planHash,
        actor: "operator",
      }),
    ).toThrow(/snapshot scope or source binding is invalid|snapshot integrity is unavailable/i);
  });
});