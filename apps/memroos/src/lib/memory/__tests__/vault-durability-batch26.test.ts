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
  vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `vault-b26-${randomUUID()}-`));
  process.env.MEMROOS_VAULT_ROOT = vaultRoot;
});

afterEach(() => {
  db?.close();
  db = null;
  delete process.env.MEMROOS_VAULT_ROOT;
  fs.rmSync(vaultRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("vault-durability batch26 — tenant read, orphan file missing, bad classification", () => {
  it("readVaultArtifactForTenant rejects cross-tenant reads", async () => {
    const { writeVaultArtifactWithDurability, readVaultArtifactForTenant } = await import("../vault-durability");
    const database = freshDb();
    const written = writeVaultArtifactWithDurability(database, {
      tenantId: "default-tenant",
      sourceType: "memory.test",
      sourceId: `src-${randomUUID().slice(0, 8)}`,
      body: "tenant scoped batch26",
      actorId: "operator",
    });
    expect(() => readVaultArtifactForTenant(database, "other-tenant", written.id)).toThrow(/tenant mismatch/);
  });

  it("markOrphanedArtifacts flags pending rows when on-disk vault file is missing", async () => {
    const { writeVaultArtifactWithDurability, markOrphanedArtifacts } = await import("../vault-durability");
    const database = freshDb();
    const written = writeVaultArtifactWithDurability(database, {
      tenantId: "default-tenant",
      sourceType: "memory.test",
      sourceId: `src-${randomUUID().slice(0, 8)}`,
      body: "orphan file batch26",
      actorId: "operator",
    });
    database.prepare(`UPDATE memory_vault_durability SET write_state = 'pending' WHERE artifact_id = ?`).run(
      written.id,
    );
    const row = database
      .prepare(`SELECT artifact_path FROM raw_artifacts WHERE id = ?`)
      .get(written.id) as { artifact_path: string };
    const absolute = path.join(vaultRoot, "default-tenant", row.artifact_path);
    if (fs.existsSync(absolute)) fs.unlinkSync(absolute);
    const marked = markOrphanedArtifacts(database, "default-tenant");
    expect(marked).toBeGreaterThanOrEqual(1);
  });

  it("replayVaultArtifactWithDurability tolerates malformed classification_json in durability row", async () => {
    const { writeVaultArtifactWithDurability, replayVaultArtifactWithDurability } = await import(
      "../vault-durability"
    );
    const database = freshDb();
    const written = writeVaultArtifactWithDurability(database, {
      tenantId: "default-tenant",
      sourceType: "memory.test",
      sourceId: `src-${randomUUID().slice(0, 8)}`,
      body: "classification parse batch26",
      actorId: "operator",
    });
    database
      .prepare(`UPDATE memory_vault_durability SET classification_json = '{bad' WHERE artifact_id = ?`)
      .run(written.id);
    const replay = replayVaultArtifactWithDurability(database, "default-tenant", written.id, "operator");
    expect(replay.replayState).toBe("complete");
  });
});
