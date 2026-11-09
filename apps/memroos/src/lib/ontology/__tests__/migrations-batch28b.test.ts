// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = path.join(os.tmpdir(), `ontology-mig-b28b-${crypto.randomUUID()}`);

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
  db.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-b28b', 'Tenant B28B')").run();
});

afterEach(() => {
  closeDb?.();
  delete process.env.MEMROOS_ROOT;
  delete process.env.SQLITE_DB_PATH;
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("ontology migrations batch28b — empty inventory guard", () => {
  it("planOntologyMigration rejects plans when source inventory has no rows", async () => {
    const registry = await import("../registry");
    const migrations = await import("../migrations");
    const ontology = registry.ensureCanonicalUpperOntology(db, "operator");
    expect(() =>
      migrations.planOntologyMigration(db, {
        tenantId: "tenant-b28b",
        spaceId: "space-empty-b28b",
        source: { ontologyId: ontology.ontologyId, version: ontology.version, hash: ontology.contentHash },
        target: { ontologyId: ontology.ontologyId, version: ontology.version, hash: ontology.contentHash },
        mappings: { legacy: ["entity"] },
        actor: "operator",
      }),
    ).toThrow(/inventory is empty/i);
  });
});
