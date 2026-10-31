// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = path.join(os.tmpdir(), `ontology-mig-b17-${crypto.randomUUID()}`);

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
});

afterEach(() => {
  closeDb?.();
  delete process.env.MEMROOS_ROOT;
  delete process.env.SQLITE_DB_PATH;
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe("ontology migrations batch17 — input validation guards", () => {
  it("planOntologyMigration rejects blank tenantId via clean()", async () => {
    const { planOntologyMigration } = await import("../migrations");
    expect(() =>
      planOntologyMigration(db, {
        tenantId: "  ",
        spaceId: "space-a",
        source: { ontologyId: "memroos.core", version: "1.0.0", hash: "sha256:src" },
        target: { ontologyId: "memroos.core", version: "1.1.0", hash: "sha256:tgt" },
        mappings: { message: ["document"] },
        actor: "operator",
      }),
    ).toThrow(/tenantId is required/);
  });

  it("approveOntologyMigration rejects missing plan in scope", async () => {
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
