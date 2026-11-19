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

const VAULT_ROOT = path.join(os.tmpdir(), `vault-b17-${crypto.randomUUID()}`);

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

describe("vault-durability batch17 — replay mismatch and tenant guards", () => {
  it("readVaultArtifactForTenant rejects cross-tenant reads", async () => {
    const { writeVaultArtifactWithDurability, readVaultArtifactForTenant } = await import("../vault-durability");
    const database = freshDb();
    const written = writeVaultArtifactWithDurability(database, {
      tenantId: "default-tenant",
      sourceType: "memory.test",
      sourceId: `src-${crypto.randomUUID().slice(0, 8)}`,
      body: "tenant scoped",
      label: { visibility: "private", policy: "sealed" },
      actorId: "operator",
    });
    expect(() => readVaultArtifactForTenant(database, "other-tenant", written.id)).toThrow(/tenant mismatch/);
  });

  it("replayVaultArtifactWithDurability marks hash mismatch when stored hash diverges", async () => {
    const { writeVaultArtifactWithDurability, replayVaultArtifactWithDurability } = await import("../vault-durability");
    const database = freshDb();
    const written = writeVaultArtifactWithDurability(database, {
      tenantId: "default-tenant",
      sourceType: "memory.test",
      sourceId: `src-${crypto.randomUUID().slice(0, 8)}`,
      body: "original payload",
      label: { visibility: "private", policy: "sealed" },
      actorId: "operator",
    });
    database
      .prepare(`UPDATE memory_vault_durability SET content_hash = ? WHERE artifact_id = ?`)
      .run("sha256:deadbeef", written.id);
    const replay = replayVaultArtifactWithDurability(database, "default-tenant", written.id, "operator");
    expect(replay.ok).toBe(false);
    expect(replay.replayState).toBe("mismatch");
  });

  it("replayVaultArtifactWithDurability records audit failure on durability row", async () => {
    const { writeVaultArtifactWithDurability, replayVaultArtifactWithDurability } = await import("../vault-durability");
    const database = freshDb();
    const written = writeVaultArtifactWithDurability(database, {
      tenantId: "default-tenant",
      sourceType: "memory.test",
      sourceId: `src-${crypto.randomUUID().slice(0, 8)}`,
      body: "payload",
      label: { visibility: "private", policy: "sealed" },
      actorId: "operator",
    });
    auditGate.failOnCall = auditGate.calls + 1;
    expect(() =>
      replayVaultArtifactWithDurability(database, "default-tenant", written.id, "operator"),
    ).toThrow(/audit_down/);
    const row = database
      .prepare(`SELECT replay_state, failure_reason FROM memory_vault_durability WHERE artifact_id = ?`)
      .get(written.id) as { replay_state: string; failure_reason: string };
    expect(row.replay_state).toBe("failed");
    expect(row.failure_reason).toMatch(/audit_receipt_failure/);
  });
});
