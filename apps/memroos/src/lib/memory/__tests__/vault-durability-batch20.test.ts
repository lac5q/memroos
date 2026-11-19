// @vitest-environment node
import crypto from "crypto";
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

const VAULT_ROOT = path.join(os.tmpdir(), `vault-b20-${crypto.randomUUID()}`);

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

beforeEach(() => {
  auditGate.failOnCall = 0;
  auditGate.calls = 0;
  fs.rmSync(VAULT_ROOT, { recursive: true, force: true });
  fs.mkdirSync(VAULT_ROOT, { recursive: true });
  process.env.MEMROOS_VAULT_ROOT = VAULT_ROOT;
});

afterEach(() => {
  db?.close();
  db = null;
  delete process.env.MEMROOS_VAULT_ROOT;
});

describe("vault-durability batch20 — write audit failures and tenant verification sweep", () => {
  it("writeVaultArtifactWithDurability marks durability failed when success audit receipt throws", async () => {
    const { writeVaultArtifactWithDurability } = await import("../vault-durability");
    const database = freshDb();
    auditGate.failOnCall = 1;
    expect(() =>
      writeVaultArtifactWithDurability(database, {
        tenantId: "default-tenant",
        sourceType: "memory.test",
        sourceId: `src-${crypto.randomUUID().slice(0, 8)}`,
        body: "payload with audit failure",
        label: { visibility: "private", policy: "sealed" },
        actorId: "operator",
      }),
    ).toThrow(/audit_down/);
    const row = database
      .prepare(`SELECT replay_state, failure_reason FROM memory_vault_durability ORDER BY created_at DESC LIMIT 1`)
      .get() as { replay_state: string; failure_reason: string };
    expect(row.replay_state).toBe("failed");
    expect(row.failure_reason).toMatch(/audit_receipt_failure/);
  });

  it("reconcileVaultDurability aggregates complete and mismatch rows", async () => {
    const { writeVaultArtifactWithDurability, reconcileVaultDurability } = await import("../vault-durability");
    const database = freshDb();
    const good = writeVaultArtifactWithDurability(database, {
      tenantId: "default-tenant",
      sourceType: "memory.test",
      sourceId: `src-good-${crypto.randomUUID().slice(0, 8)}`,
      body: "good payload",
      label: { visibility: "private", policy: "sealed" },
      actorId: "operator",
    });
    const bad = writeVaultArtifactWithDurability(database, {
      tenantId: "default-tenant",
      sourceType: "memory.test",
      sourceId: `src-bad-${crypto.randomUUID().slice(0, 8)}`,
      body: "bad payload",
      label: { visibility: "private", policy: "sealed" },
      actorId: "operator",
    });
    database
      .prepare(`UPDATE memory_vault_durability SET content_hash = ? WHERE artifact_id = ?`)
      .run("sha256:deadbeef", bad.id);
    const summary = reconcileVaultDurability(database, "default-tenant", "operator");
    expect(summary.ok).toBeGreaterThanOrEqual(1);
    expect(summary.mismatched).toContain(bad.id);
  });

  it("readVaultArtifactForTenant returns artifact for matching tenant", async () => {
    const { writeVaultArtifactWithDurability, readVaultArtifactForTenant } = await import("../vault-durability");
    const database = freshDb();
    const written = writeVaultArtifactWithDurability(database, {
      tenantId: "default-tenant",
      sourceType: "memory.test",
      sourceId: `src-read-${crypto.randomUUID().slice(0, 8)}`,
      body: "tenant scoped read",
      label: { visibility: "private", policy: "sealed" },
      actorId: "operator",
    });
    const replayed = readVaultArtifactForTenant(database, "default-tenant", written.id);
    expect(replayed.tenantId).toBe("default-tenant");
    expect(replayed.contentHash).toBe(written.contentHash);
  });
});
