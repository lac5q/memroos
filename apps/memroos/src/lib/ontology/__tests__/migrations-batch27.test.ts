// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = path.join(os.tmpdir(), `ontology-mig-b27-${crypto.randomUUID()}`);

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
  vi.restoreAllMocks();
});

async function seedPlan() {
  const registry = await import("../registry");
  const migrations = await import("../migrations");
  const ontology = registry.ensureCanonicalUpperOntology(db, "operator");
  const document = {
    id: ontology.ontologyId,
    version: "1.1.0",
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
  const sourceLifecycleHash = `sha256:${"d".repeat(64)}`;
  const sourceId = "source:legacy:record-b27";
  const recordId = `vr-b27-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO ontology_versioned_records
      (id, tenant_id, space_id, record_type, record_id, qualified_type, ontology_id, ontology_version, ontology_content_hash, legacy_type, mapping_path_json, created_at, source_id, source_hash)
     VALUES (?, 'tenant-a', 'space-a', 'knowledge', 'record-b27', 'legacy', ?, ?, ?, 'legacy', '[]', ?, ?, ?)`,
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
  return { migrations, plan, target, ontology };
}

describe("ontology migrations batch27 — snapshot and approval guards", () => {
  it("planOntologyMigration rejects mappings with unsafe target vocabulary", async () => {
    const registry = await import("../registry");
    const migrations = await import("../migrations");
    const ontology = registry.ensureCanonicalUpperOntology(db, "operator");
    expect(() =>
      migrations.planOntologyMigration(db, {
        tenantId: "tenant-a",
        spaceId: "space-a",
        source: { ontologyId: ontology.ontologyId, version: ontology.version, hash: ontology.contentHash },
        target: { ontologyId: ontology.ontologyId, version: ontology.version, hash: ontology.contentHash },
        mappings: { legacy: ["NOT A VALID TYPE"] },
        actor: "operator",
      }),
    ).toThrow(/malformed or unsupported/);
  });

  it("approveOntologyMigration rejects stale plan hashes", async () => {
    const { migrations, plan } = await seedPlan();
    expect(() =>
      migrations.approveOntologyMigration(db, {
        planId: plan.id,
        tenantId: "tenant-a",
        spaceId: "space-a",
        planHash: `sha256:${"dead".repeat(16)}`,
        actor: "operator",
      }),
    ).toThrow(/planned hash/);
  });

  it("executeOntologyMigration throws when the plan id is missing", async () => {
    const migrations = await import("../migrations");
    expect(() =>
      migrations.executeOntologyMigration(db, {
        planId: "ontmig_missing_b27",
        tenantId: "tenant-a",
        spaceId: "space-a",
        actor: "operator",
      }),
    ).toThrow(/not found/);
  });

});
