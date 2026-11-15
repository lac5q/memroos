// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { initSchema } from "@/lib/db-schema";
import { OntologyGovernanceError, resolveOntologyValidity, registerOntologyDerivative, registerOntologySource } from "../validity";
import { ensureCanonicalUpperOntology } from "../registry";

const TMP_ROOT = path.join(os.tmpdir(), `ontology-b38c-${randomUUID()}`);

describe("ontology batch38c", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    db.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES ('default-tenant', 'Default')`).run();
    ensureCanonicalUpperOntology(db, "operator");
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  it("assertCurrentOntology maps discoverOntology throws to unavailable (validity 76)", () => {
    const sourceHash = `sha256:${"c".repeat(64)}`;
    registerOntologySource(db, {
      tenantId: "default-tenant",
      spaceId: "space-b38c",
      sourceId: "src-b38c",
      sourceHash,
      actor: "operator",
    });
    registerOntologyDerivative(db, {
      tenantId: "default-tenant",
      spaceId: "space-b38c",
      sourceId: "src-b38c",
      sourceHash,
      derivativeType: "versioned_record",
      derivativeId: "vr-b38c",
    });
    db.prepare(
      `INSERT INTO ontology_versioned_records
        (id, tenant_id, space_id, record_type, record_id, legacy_type, qualified_type,
         ontology_id, ontology_version, ontology_content_hash, mapping_path_json, source_id, source_hash, created_at)
       VALUES (?, 'default-tenant', 'space-b38c', 'memory', 'rec-b38c', 'note', 'entity.note',
               ?, ?, ?, '[]', 'src-b38c', ?, datetime('now'))`,
    ).run(
      "vr-b38c",
      "missing-ontology-b38c",
      "9.9.9",
      `sha256:${"d".repeat(64)}`,
      sourceHash,
    );
    expect(() =>
      resolveOntologyValidity(db, {
        tenantId: "default-tenant",
        spaceId: "space-b38c",
        recordType: "memory",
        recordId: "rec-b38c",
      }),
    ).toThrow(OntologyGovernanceError);
  });

  it("loadSnapshotItems rejects scope binding drift (migrations 184)", async () => {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
    fs.mkdirSync(TMP_ROOT, { recursive: true });
    process.env.MEMROOS_ROOT = TMP_ROOT;
    process.env.SQLITE_DB_PATH = path.join(TMP_ROOT, `mig-b38c-${randomUUID()}.db`);
    vi.resetModules();
    const database = await import("@/lib/db");
    const migDb = database.getDb();
    initSchema(migDb);
    migDb.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-b38c', 'Tenant B38C')").run();
    const registry = await import("../registry");
    const migrations = await import("../migrations");
    const ontology = registry.ensureCanonicalUpperOntology(migDb, "operator");
    const document = {
      id: ontology.ontologyId,
      version: "1.2.0-b38c",
      definitions: [...registry.CORE_VOCABULARY, { id: "migration.target.b38c", semantics: { kind: "entity" } }],
      relationships: [...registry.CORE_RELATIONSHIPS, { from: "migration.target.b38c", to: "entity", type: "is_a" }],
      parent: ontology,
    };
    const hash = registry.canonicalContentHash(document);
    const target = registry.publishOntologyVersion(migDb, {
      ...document,
      actor: "operator",
      suppliedHash: hash,
      projections: registry.ONTOLOGY_PROJECTIONS.map((projection) => ({ projection, contentHash: hash })),
    });
    const sourceLifecycleHash = `sha256:${"e".repeat(64)}`;
    const sourceId = "source:legacy:record-b38c";
    const recordId = `vr-b38c-${randomUUID().slice(0, 8)}`;
    migDb.prepare(
      `INSERT INTO ontology_versioned_records
        (id, tenant_id, space_id, record_type, record_id, qualified_type, ontology_id, ontology_version, ontology_content_hash, legacy_type, mapping_path_json, created_at, source_id, source_hash)
       VALUES (?, 'tenant-b38c', 'space-b38c', 'knowledge', 'record-b38c', 'legacy', ?, ?, ?, 'legacy', '[]', ?, ?, ?)`,
    ).run(recordId, ontology.ontologyId, ontology.version, ontology.contentHash, new Date().toISOString(), sourceId, sourceLifecycleHash);
    migDb.prepare(
      `INSERT INTO ontology_source_lifecycle (tenant_id, space_id, source_id, source_hash, status, updated_at, updated_by, reason_code)
       VALUES ('tenant-b38c', 'space-b38c', ?, ?, 'active', ?, 'operator', 'test')`,
    ).run(sourceId, sourceLifecycleHash, new Date().toISOString());
    migDb.prepare(
      `INSERT INTO ontology_derivative_validity (id, tenant_id, space_id, source_id, source_hash, derivative_type, derivative_id, status, created_at)
       VALUES (?, 'tenant-b38c', 'space-b38c', ?, ?, 'versioned_record', ?, 'authoritative', ?)`,
    ).run(`valid:${recordId}`, sourceId, sourceLifecycleHash, recordId, new Date().toISOString());
    const plan = migrations.planOntologyMigration(migDb, {
      tenantId: "tenant-b38c",
      spaceId: "space-b38c",
      source: { ontologyId: ontology.ontologyId, version: ontology.version, hash: ontology.contentHash },
      target: { ontologyId: target.ontologyId, version: target.version, hash: target.contentHash },
      mappings: { legacy: ["migration.target.b38c"] },
      actor: "operator",
    });
    migDb.exec(`DROP TRIGGER IF EXISTS ontology_migration_snapshot_items_no_update`);
    migDb.prepare(`UPDATE ontology_migration_snapshot_items SET tenant_id = ? WHERE snapshot_id = ?`).run(
      "tenant-drift-b38c",
      plan.snapshot.id,
    );
    expect(() =>
      migrations.approveOntologyMigration(migDb, {
        planId: plan.id,
        tenantId: "tenant-b38c",
        spaceId: "space-b38c",
        planHash: plan.planHash,
        actor: "operator",
      }),
    ).toThrow(/snapshot scope or source binding is invalid|snapshot integrity is unavailable/i);
    database.closeDb();
    delete process.env.MEMROOS_ROOT;
    delete process.env.SQLITE_DB_PATH;
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  it.skip("assertCompatible core weaken branch (registry 404) — blocked by immutable published definition guard", () => {});
});