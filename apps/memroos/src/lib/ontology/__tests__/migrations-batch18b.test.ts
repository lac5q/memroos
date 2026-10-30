// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = path.join(os.tmpdir(), `ontology-mig-b18b-${crypto.randomUUID()}`);

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

describe("ontology migrations batch18b", () => {
  it("planOntologyMigration rejects blank actor", async () => {
    const { planOntologyMigration } = await import("../migrations");
    expect(() =>
      planOntologyMigration(db, {
        tenantId: "tenant-a",
        spaceId: "space-a",
        source: { ontologyId: "memroos.core", version: "1.0.0", hash: "sha256:src" },
        target: { ontologyId: "memroos.core", version: "1.1.0", hash: "sha256:tgt" },
        mappings: { message: ["document"] },
        actor: "  ",
      }),
    ).toThrow(/actor is required/);
  });

  it("approveOntologyMigration rejects plan hash mismatch", async () => {
    const { approveOntologyMigration } = await import("../migrations");
    expect(() =>
      approveOntologyMigration(db, {
        planId: `missing-${crypto.randomUUID()}`,
        tenantId: "tenant-a",
        spaceId: "space-a",
        planHash: "sha256:plan",
        actor: "operator",
      }),
    ).toThrow(/migration plan not found/);
  });
});
