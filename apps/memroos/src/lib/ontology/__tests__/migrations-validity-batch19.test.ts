// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = path.join(os.tmpdir(), `ontology-b19-${crypto.randomUUID()}`);

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

async function seedMigrationInventory() {
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
  const sourceId = "source:legacy:record-b19";
  const recordId = `vr-b19-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO ontology_versioned_records
      (id, tenant_id, space_id, record_type, record_id, qualified_type, ontology_id, ontology_version, ontology_content_hash, legacy_type, mapping_path_json, created_at, source_id, source_hash)
     VALUES (?, 'tenant-a', 'space-a', 'knowledge', 'record-b19', 'legacy', ?, ?, ?, 'legacy', '[]', ?, ?, ?)`,
  ).run(recordId, ontology.ontologyId, ontology.version, ontology.contentHash, new Date().toISOString(), sourceId, sourceLifecycleHash);
  db.prepare(
    `INSERT INTO ontology_source_lifecycle (tenant_id, space_id, source_id, source_hash, status, updated_at, updated_by, reason_code)
     VALUES ('tenant-a', 'space-a', ?, ?, 'active', ?, 'operator', 'test')`,
  ).run(sourceId, sourceLifecycleHash, new Date().toISOString());
  db.prepare(
    `INSERT INTO ontology_derivative_validity (id, tenant_id, space_id, source_id, source_hash, derivative_type, derivative_id, status, created_at)
     VALUES (?, 'tenant-a', 'space-a', ?, ?, 'versioned_record', ?, 'authoritative', ?)`,
  ).run(`valid:${recordId}`, sourceId, sourceLifecycleHash, recordId, new Date().toISOString());
  return { ontology, target, migrations };
}

describe("ontology migrations + validity batch19", () => {
  it("planOntologyMigration rejects malformed mapping targets", async () => {
    const { ontology, target, migrations } = await seedMigrationInventory();
    expect(() =>
      migrations.planOntologyMigration(db, {
        tenantId: "tenant-a",
        spaceId: "space-a",
        source: { ontologyId: ontology.ontologyId, version: ontology.version, hash: ontology.contentHash },
        target: { ontologyId: target.ontologyId, version: target.version, hash: target.contentHash },
        mappings: { legacy: ["not-a-real-type!!!"] },
        actor: "operator",
      }),
    ).toThrow(/malformed or unsupported/);
  });

  it("resolveOntologyValidity surfaces unavailable ontology context", async () => {
    const { resolveOntologyValidity } = await import("../validity");
    expect(() =>
      resolveOntologyValidity(db, {
        tenantId: "tenant-a",
        spaceId: "space-a",
        recordType: "message",
        recordId: "missing-b19",
      }),
    ).toThrow(/ontology context is unavailable|stale or unavailable/);
  });

  it("assertCandidateAuthoritative rejects non-approved candidates", async () => {
    const { assertCandidateAuthoritative } = await import("../validity");
    expect(() =>
      assertCandidateAuthoritative(db, {
        tenantId: "tenant-a",
        spaceId: "space-a",
        candidateId: `missing-${crypto.randomUUID()}`,
      }),
    ).toThrow(/not authoritative/);
  });
});
