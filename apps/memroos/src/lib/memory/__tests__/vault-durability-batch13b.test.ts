// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  markOrphanedArtifacts,
  readVaultArtifactForTenant,
  reconcileVaultDurability,
  replayVaultArtifactWithDurability,
  writeVaultArtifactWithDurability,
} from "../vault-durability";

const VAULT_ROOT = path.join(os.tmpdir(), `vault-b13b-${crypto.randomUUID()}`);

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

beforeEach(() => {
  fs.rmSync(VAULT_ROOT, { recursive: true, force: true });
  fs.mkdirSync(VAULT_ROOT, { recursive: true });
  process.env["MEMROOS_VAULT_ROOT"] = VAULT_ROOT;
});

afterEach(() => {
  db?.close();
  db = null;
  delete process.env["MEMROOS_VAULT_ROOT"];
});

describe("vault-durability batch13b — orphan and replay edges", () => {
  it("replayVaultArtifactWithDurability throws when durability row is missing", () => {
    const database = freshDb();
    expect(() =>
      replayVaultArtifactWithDurability(database, "default-tenant", `missing-${crypto.randomUUID()}`, "operator")
    ).toThrow(/vault durability row missing/);
  });

  it("readVaultArtifactForTenant rejects cross-tenant reads", () => {
    const database = freshDb();
    const written = writeVaultArtifactWithDurability(database, {
      tenantId: "default-tenant",
      sourceType: "memory.test",
      sourceId: "src-cross",
      body: "secret",
      label: { visibility: "private", policy: "sealed" },
      actorId: "operator",
    });
    expect(() => readVaultArtifactForTenant(database, "tenant-b", written.id)).toThrow(/tenant mismatch/);
  });

  it("markOrphanedArtifacts flags pending rows whose raw_artifacts row vanished", () => {
    const database = freshDb();
    const artifactId = `art-${crypto.randomUUID()}`;
    database
      .prepare(
        `INSERT INTO memory_vault_durability
         (id, tenant_id, artifact_id, artifact_uri, content_hash, write_state, replay_state, classification_json, label_version, created_at, updated_at)
         VALUES (?, 'default-tenant', ?, 'memroos://vault/x', ?, 'pending', 'pending', '{}', 1, ?, ?)`
      )
      .run(`dur-${crypto.randomUUID()}`, artifactId, "a".repeat(64), "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z");
    const marked = markOrphanedArtifacts(database, "default-tenant");
    expect(marked).toBeGreaterThanOrEqual(1);
    const row = database
      .prepare(`SELECT write_state FROM memory_vault_durability WHERE artifact_id = ?`)
      .get(artifactId) as { write_state: string };
    expect(row.write_state).toBe("orphaned");
  });

  it("reconcileVaultDurability returns summary counts for tenant artifacts", () => {
    const database = freshDb();
    writeVaultArtifactWithDurability(database, {
      tenantId: "default-tenant",
      sourceType: "memory.test",
      sourceId: "src-reconcile",
      body: "payload",
      label: { visibility: "private", policy: "sealed" },
      actorId: "operator",
    });
    const summary = reconcileVaultDurability(database, "default-tenant", "operator");
    expect(summary.ok).toBeGreaterThanOrEqual(1);
    expect(summary.failed).toEqual([]);
  });

  it("replay marks failure when artifact file disappears from disk", () => {
    const database = freshDb();
    const written = writeVaultArtifactWithDurability(database, {
      tenantId: "default-tenant",
      sourceType: "memory.test",
      sourceId: "src-vanish",
      body: "will vanish",
      label: { visibility: "private", policy: "sealed" },
      actorId: "operator",
    });
    const artifact = database
      .prepare(`SELECT artifact_path FROM raw_artifacts WHERE id = ?`)
      .get(written.id) as { artifact_path: string };
    const absolute = path.join(VAULT_ROOT, "default-tenant", artifact.artifact_path);
    if (fs.existsSync(absolute)) fs.unlinkSync(absolute);
    const replay = replayVaultArtifactWithDurability(database, "default-tenant", written.id, "operator");
    expect(replay.ok).toBe(false);
    expect(replay.replayState).toBe("failed");
  });
});
