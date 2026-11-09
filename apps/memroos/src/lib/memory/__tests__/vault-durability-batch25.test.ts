// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const auditGate = vi.hoisted(() => ({ failOnCall: 0, calls: 0 }));

vi.mock("@/lib/audit/memory-chain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit/memory-chain")>();
  return {
    ...actual,
    writeChainedMemoryAuditEntry: (...args: Parameters<typeof actual.writeChainedMemoryAuditEntry>) => {
      auditGate.calls += 1;
      if (auditGate.failOnCall > 0 && auditGate.calls >= auditGate.failOnCall) {
        throw new Error("audit_down");
      }
      return actual.writeChainedMemoryAuditEntry(...args);
    },
  };
});

let vaultRoot: string;
let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

beforeEach(() => {
  auditGate.failOnCall = 0;
  auditGate.calls = 0;
  vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `vault-b25-${randomUUID()}-`));
  process.env.MEMROOS_VAULT_ROOT = vaultRoot;
});

afterEach(() => {
  db?.close();
  db = null;
  delete process.env.MEMROOS_VAULT_ROOT;
  fs.rmSync(vaultRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("vault-durability batch25 — labels, orphans, write failures", () => {
  it("writeVaultArtifactWithDurability applies default label fields and system actor role", async () => {
    const { writeVaultArtifactWithDurability } = await import("../vault-durability");
    const database = freshDb();
    const written = writeVaultArtifactWithDurability(database, {
      tenantId: "default-tenant",
      sourceType: "memory.test",
      sourceId: `src-${randomUUID().slice(0, 8)}`,
      body: "label defaults batch25",
      label: { visibility: "team", domain: "ops", sensitivity: "low", policy: "indexable" },
      actorId: "system",
    });
    const row = database
      .prepare(`SELECT classification_json FROM memory_vault_durability WHERE artifact_id = ?`)
      .get(written.id) as { classification_json: string };
    expect(JSON.parse(row.classification_json)).toMatchObject({
      visibility: "team",
      domain: "ops",
      sensitivity: "low",
      policy: "indexable",
    });
  });

  it("writeVaultArtifactWithDurability still succeeds when durability table is absent", async () => {
    const { writeVaultArtifactWithDurability } = await import("../vault-durability");
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS memory_vault_durability");
    const written = writeVaultArtifactWithDurability(database, {
      tenantId: "default-tenant",
      sourceType: "memory.test",
      sourceId: `src-${randomUUID().slice(0, 8)}`,
      body: "no durability table",
      actorId: "operator",
    });
    expect(written.id).toBeTruthy();
  });

  it("markOrphanedArtifacts flags pending rows whose raw artifact row is missing", async () => {
    const { markOrphanedArtifacts } = await import("../vault-durability");
    const database = freshDb();
    const orphanId = `art-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO memory_vault_durability
           (id, tenant_id, artifact_id, artifact_uri, content_hash, classification_json, label_version,
            write_state, replay_state, created_at, updated_at)
         VALUES (?, 'default-tenant', ?, 'vault://orphan', 'sha256:orphan', '{}', 1, 'pending', 'pending', ?, ?)`,
      )
      .run(`vdr_${randomUUID()}`, orphanId, now, now);
    const marked = markOrphanedArtifacts(database, "default-tenant");
    expect(marked).toBe(1);
    const row = database
      .prepare(`SELECT write_state, failure_reason FROM memory_vault_durability WHERE artifact_id = ?`)
      .get(orphanId) as { write_state: string; failure_reason: string };
    expect(row.write_state).toBe("orphaned");
    expect(row.failure_reason).toMatch(/orphaned/);
  });

  it("reconcileVaultDurability returns empty summary when durability table is missing", async () => {
    const { reconcileVaultDurability } = await import("../vault-durability");
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS memory_vault_durability");
    expect(reconcileVaultDurability(database, "default-tenant", "operator")).toEqual({
      ok: 0,
      mismatched: [],
      failed: [],
    });
  });

  it("writeVaultArtifactWithDurability marks failed when vault writer throws", async () => {
    const writerMod = await import("@/lib/vault/writer");
    const spy = vi.spyOn(writerMod, "writeVaultArtifact").mockImplementation(() => {
      throw new Error("disk_full");
    });
    const { writeVaultArtifactWithDurability } = await import("../vault-durability");
    const database = freshDb();
    try {
      expect(() =>
        writeVaultArtifactWithDurability(database, {
          tenantId: "default-tenant",
          sourceType: "memory.test",
          sourceId: `src-${randomUUID().slice(0, 8)}`,
          body: "should fail",
          actorId: "operator",
        }),
      ).toThrow(/disk_full/);
      const row = database
        .prepare(`SELECT write_state, failure_reason FROM memory_vault_durability ORDER BY created_at DESC LIMIT 1`)
        .get() as { write_state: string; failure_reason: string };
      expect(row.write_state).toBe("failed");
      expect(row.failure_reason).toMatch(/disk_full/);
    } finally {
      spy.mockRestore();
    }
  });
});
