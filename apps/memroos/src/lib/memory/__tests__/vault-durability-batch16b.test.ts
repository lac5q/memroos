// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  listVaultArtifactsForTenant,
  markOrphanedArtifacts,
  reconcileVaultDurability,
  writeVaultArtifactWithDurability,
} from "../vault-durability";

const VAULT_ROOT = path.join(os.tmpdir(), `vault-b16b-${crypto.randomUUID()}`);

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

beforeEach(() => {
  fs.rmSync(VAULT_ROOT, { recursive: true, force: true });
  fs.mkdirSync(VAULT_ROOT, { recursive: true });
  process.env.MEMROOS_VAULT_ROOT = VAULT_ROOT;
});

afterEach(() => {
  db?.close();
  db = null;
  delete process.env.MEMROOS_VAULT_ROOT;
});

describe("vault-durability batch16b", () => {
  it("write + reconcile completes replay for durable artifact", () => {
    const database = freshDb();
    const written = writeVaultArtifactWithDurability(database, {
      tenantId: "default-tenant",
      sourceType: "memory.test",
      sourceId: `src-${crypto.randomUUID().slice(0, 8)}`,
      body: "durable payload",
      label: { visibility: "private", policy: "sealed" },
      actorId: "operator",
    });
    const listed = listVaultArtifactsForTenant(database, "default-tenant", { limit: 5 });
    expect(listed.artifacts.some((item) => item.id === written.id)).toBe(true);
    const reconciled = reconcileVaultDurability(database, "default-tenant", "operator");
    expect(reconciled.ok).toBeGreaterThanOrEqual(1);
    expect(reconciled.failed).toEqual([]);
  });

  it("markOrphanedArtifacts flags pending durability without artifact row", () => {
    const database = freshDb();
    database
      .prepare(
        `INSERT INTO memory_vault_durability
         (id, tenant_id, artifact_id, artifact_uri, content_hash, write_state, replay_state,
          classification_json, label_version, created_at, updated_at)
         VALUES (?, 'default-tenant', 'orphan-artifact', 'vault://missing', 'deadbeef', 'pending', 'pending', '{}', 1, ?, ?)`,
      )
      .run(`dur-${crypto.randomUUID()}`, "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
    const marked = markOrphanedArtifacts(database, "default-tenant");
    expect(marked).toBeGreaterThanOrEqual(1);
  });

  it("reconcileVaultDurability no-ops when durability table missing", () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS memory_vault_durability");
    expect(reconcileVaultDurability(database, "default-tenant", "operator")).toEqual({
      ok: 0,
      mismatched: [],
      failed: [],
    });
  });
});
