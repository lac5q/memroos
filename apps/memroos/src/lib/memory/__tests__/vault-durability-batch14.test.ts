// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  markOrphanedArtifacts,
  replayVaultArtifactWithDurability,
  writeVaultArtifactWithDurability,
} from "../vault-durability";
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

const VAULT_ROOT = path.join(os.tmpdir(), `vault-b14-${crypto.randomUUID()}`);

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
  process.env["MEMROOS_VAULT_ROOT"] = VAULT_ROOT;
});

afterEach(() => {
  db?.close();
  db = null;
  vi.restoreAllMocks();
  delete process.env["MEMROOS_VAULT_ROOT"];
});

describe("vault-durability batch14 — replay and orphan edges", () => {
  it("writeVaultArtifactWithDurability rejects invalid now timestamps", () => {
    const database = freshDb();
    expect(() =>
      writeVaultArtifactWithDurability(database, {
        tenantId: "default-tenant",
        sourceType: "memory.test",
        body: "x",
        label: { visibility: "private", policy: "sealed" },
        actorId: "operator",
        now: "not-a-date",
      })
    ).toThrow(/Invalid UTC timestamp/);
  });

  it("replayVaultArtifactWithDurability records tenant mismatch as failed replay", () => {
    const database = freshDb();
    const written = writeVaultArtifactWithDurability(database, {
      tenantId: "default-tenant",
      sourceType: "memory.test",
      sourceId: "src-tenant-mismatch",
      body: "payload",
      label: { visibility: "private", policy: "sealed" },
      actorId: "operator",
    });
    database
      .prepare(
        `INSERT INTO memory_vault_durability
         (id, tenant_id, artifact_id, artifact_uri, content_hash, write_state, replay_state, classification_json, label_version, created_at, updated_at)
         VALUES (?, 'tenant-other', ?, ?, ?, 'complete', 'pending', '{}', 1, ?, ?)`
      )
      .run(
        `dur-${crypto.randomUUID()}`,
        written.id,
        written.artifactUri,
        written.contentHash,
        "2026-01-01T00:00:00Z",
        "2026-01-01T00:00:00Z"
      );
    database.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES ('tenant-other', 'Tenant Other')`).run();
    auditGate.failOnCall = 0;
    const replay = replayVaultArtifactWithDurability(database, "tenant-other", written.id, "operator");
    expect(replay.ok).toBe(false);
    expect(replay.replayState).toBe("failed");
    expect(replay.failureReason).toMatch(/tenant mismatch/);
  });

  it("replayVaultArtifactWithDurability updates durability when audit receipt write fails", () => {
    const database = freshDb();
    const written = writeVaultArtifactWithDurability(database, {
      tenantId: "default-tenant",
      sourceType: "memory.test",
      sourceId: "src-audit-fail",
      body: "payload",
      label: { visibility: "private", policy: "sealed" },
      actorId: "operator",
    });
    auditGate.failOnCall = auditGate.calls + 1;
    expect(() =>
      replayVaultArtifactWithDurability(database, "default-tenant", written.id, "operator")
    ).toThrow(/audit_down/);
    const row = database
      .prepare(`SELECT replay_state, failure_reason FROM memory_vault_durability WHERE artifact_id = ?`)
      .get(written.id) as { replay_state: string; failure_reason: string | null };
    expect(row.replay_state).toBe("failed");
    expect(row.failure_reason).toMatch(/audit_receipt_failure/);
  });

  it("markOrphanedArtifacts treats fs.existsSync failures as missing files", () => {
    const database = freshDb();
    const written = writeVaultArtifactWithDurability(database, {
      tenantId: "default-tenant",
      sourceType: "memory.test",
      sourceId: "src-orphan",
      body: "payload",
      label: { visibility: "private", policy: "sealed" },
      actorId: "operator",
    });
    database
      .prepare(`UPDATE memory_vault_durability SET write_state = 'pending' WHERE artifact_id = ?`)
      .run(written.id);
    const artifact = database
      .prepare(`SELECT artifact_path FROM raw_artifacts WHERE id = ?`)
      .get(written.id) as { artifact_path: string };
    const absolute = path.join(VAULT_ROOT, "default-tenant", artifact.artifact_path);
    if (fs.existsSync(absolute)) fs.unlinkSync(absolute);
    const existsOrig = fs.existsSync.bind(fs);
    const existsSpy = vi.spyOn(fs, "existsSync").mockImplementation((p) => {
      if (String(p) === absolute) throw new Error("fs_exists_boom");
      return existsOrig(p);
    });
    try {
      const marked = markOrphanedArtifacts(database, "default-tenant");
      expect(marked).toBeGreaterThanOrEqual(1);
    } finally {
      existsSpy.mockRestore();
    }
  });

  it("loadDurabilityRow tolerates invalid classification_json via replay path", () => {
    const database = freshDb();
    const written = writeVaultArtifactWithDurability(database, {
      tenantId: "default-tenant",
      sourceType: "memory.test",
      sourceId: "src-bad-class",
      body: "payload",
      label: { visibility: "private", policy: "sealed" },
      actorId: "operator",
    });
    database
      .prepare(`UPDATE memory_vault_durability SET classification_json = 'not-json' WHERE artifact_id = ?`)
      .run(written.id);
    const replay = replayVaultArtifactWithDurability(database, "default-tenant", written.id, "operator");
    expect(replay.ok).toBe(true);
    expect(replay.replayState).toBe("complete");
  });
});
