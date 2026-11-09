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
  vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `vault-b27-${randomUUID()}-`));
  process.env.MEMROOS_VAULT_ROOT = vaultRoot;
});

afterEach(() => {
  db?.close();
  db = null;
  delete process.env.MEMROOS_VAULT_ROOT;
  fs.rmSync(vaultRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("vault-durability batch27 — missing durability table, failure receipt audit swallow", () => {
  it("markOrphanedArtifacts returns zero when durability table is absent", async () => {
    const { markOrphanedArtifacts } = await import("../vault-durability");
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS memory_vault_durability");
    expect(markOrphanedArtifacts(database, "default-tenant")).toBe(0);
  });

  it("writeVaultArtifactWithDurability still records failed row when failure audit write throws", async () => {
    auditGate.failOnCall = 99;
    const writerMod = await import("@/lib/vault/writer");
    const spy = vi.spyOn(writerMod, "writeVaultArtifact").mockImplementation(() => {
      throw new Error("disk_full_batch27");
    });
    const { writeVaultArtifactWithDurability } = await import("../vault-durability");
    const database = freshDb();
    try {
      expect(() =>
        writeVaultArtifactWithDurability(database, {
          tenantId: "default-tenant",
          sourceType: "memory.test",
          sourceId: `src-${randomUUID().slice(0, 8)}`,
          body: "audit swallow batch27",
          actorId: "operator",
        }),
      ).toThrow(/disk_full_batch27/);
      const row = database
        .prepare(`SELECT write_state, failure_reason FROM memory_vault_durability ORDER BY created_at DESC LIMIT 1`)
        .get() as { write_state: string; failure_reason: string };
      expect(row.write_state).toBe("failed");
      expect(row.failure_reason).toMatch(/disk_full_batch27/);
    } finally {
      spy.mockRestore();
    }
  });
});
