// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  buildMemoryAuditEntry,
  memoryAuditEntryHash,
  previousMemoryEntryHash,
  verifyMemoryAuditChain,
  verifyMemoryAuditChainWithFault,
  writeChainedMemoryAuditEntry,
} from "../memory-chain";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("memory lifecycle audit chain (VAL-MEM-029)", () => {
  it("writes a chain entry with entryHash + previousEntryHash", () => {
    const database = freshDb();
    writeChainedMemoryAuditEntry(database, {
      tenantId: "default-tenant",
      actorId: "operator",
      actorRole: "operator",
      eventType: "memory.consolidation.run",
      entityType: "memory_consolidation",
      entityId: "consolidation_run:con_1",
      reason: "consolidation_completed",
      metadata: { run_id: "con_1", status: "completed", summary_id: "sum_1" },
      createdAt: "2026-07-01T00:00:00.000Z",
    });

    const row = database.prepare("SELECT metadata_json FROM audit_entries WHERE event_type = ?").get("memory.consolidation.run") as { metadata_json: string };
    const parsed = JSON.parse(row.metadata_json);
    expect(parsed.entryHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(parsed.previousEntryHash).toBeNull();
    expect(parsed.schemaVersion).toBe(1);
  });

  it("chains subsequent entries via previousEntryHash", () => {
    const database = freshDb();
    writeChainedMemoryAuditEntry(database, {
      tenantId: "default-tenant",
      actorId: "operator",
      actorRole: "operator",
      eventType: "memory.consolidation.run",
      entityType: "memory_consolidation",
      entityId: "consolidation_run:con_1",
      reason: "consolidation_completed",
      metadata: { run_id: "con_1" },
      createdAt: "2026-07-01T00:00:00.000Z",
    });
    const firstHash = previousMemoryEntryHash(database, "default-tenant");
    expect(firstHash).toMatch(/^sha256:/);

    writeChainedMemoryAuditEntry(database, {
      tenantId: "default-tenant",
      actorId: "operator",
      actorRole: "operator",
      eventType: "memory.vault.write",
      entityType: "memory_vault",
      entityId: "vault_artifact:v1",
      reason: "vault_write_succeeded",
      metadata: { artifact_id: "v1", content_hash: "abc" },
      createdAt: "2026-07-01T00:01:00.000Z",
    });

    const row = database.prepare("SELECT metadata_json FROM audit_entries WHERE event_type = ?").get("memory.vault.write") as { metadata_json: string };
    const parsed = JSON.parse(row.metadata_json);
    expect(parsed.previousEntryHash).toBe(firstHash);
  });

  it("verifyMemoryAuditChain returns valid when chain is intact", () => {
    const database = freshDb();
    writeChainedMemoryAuditEntry(database, {
      tenantId: "default-tenant",
      actorId: "operator",
      actorRole: "operator",
      eventType: "memory.consolidation.run",
      entityType: "memory_consolidation",
      entityId: "consolidation_run:con_1",
      reason: "consolidation_completed",
      metadata: { run_id: "con_1" },
    });
    writeChainedMemoryAuditEntry(database, {
      tenantId: "default-tenant",
      actorId: "operator",
      actorRole: "operator",
      eventType: "memory.vault.write",
      entityType: "memory_vault",
      entityId: "vault_artifact:v1",
      reason: "vault_write_succeeded",
      metadata: { artifact_id: "v1" },
    });
    const result = verifyMemoryAuditChain(database, "default-tenant");
    expect(result.valid).toBe(true);
    expect(result.checked).toBe(2);
    expect(result.scope).toBe("memory");
  });

  it("detect tampered metadata (entryHash mismatch)", () => {
    const database = freshDb();
    writeChainedMemoryAuditEntry(database, {
      tenantId: "default-tenant",
      actorId: "operator",
      actorRole: "operator",
      eventType: "memory.consolidation.run",
      entityType: "memory_consolidation",
      entityId: "consolidation_run:con_1",
      reason: "consolidation_completed",
      metadata: { run_id: "con_1", status: "completed" },
    });
    writeChainedMemoryAuditEntry(database, {
      tenantId: "default-tenant",
      actorId: "operator",
      actorRole: "operator",
      eventType: "memory.vault.write",
      entityType: "memory_vault",
      entityId: "vault_artifact:v1",
      reason: "vault_write_succeeded",
      metadata: { artifact_id: "v1" },
    });

    // Simulate tampering via the fault injector (audit_entries is append-only,
    // so direct UPDATE is blocked by SQLite triggers).
    let inspected = false;
    const result = verifyMemoryAuditChainWithFault(
      database,
      "default-tenant",
      (row, metadata) => {
        if (!inspected && row.event_type === "memory.vault.write") {
          inspected = true;
          return {
            ...metadata,
            entryHash: "sha256:" + "0".repeat(64),
          };
        }
        return metadata;
      }
    );
    expect(inspected).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.firstBrokenEntryId).toBeDefined();
    expect(result.reason).toMatch(/entryHash mismatch/);
  });

  it("detect deletion (missing entryHash)", () => {
    const database = freshDb();
    writeChainedMemoryAuditEntry(database, {
      tenantId: "default-tenant",
      actorId: "operator",
      actorRole: "operator",
      eventType: "memory.consolidation.run",
      entityType: "memory_consolidation",
      entityId: "consolidation_run:con_1",
      reason: "consolidation_completed",
      metadata: { run_id: "con_1" },
    });
    // Inject a row with metadata missing entryHash (simulate tampering)
    database.prepare(
      `INSERT INTO audit_entries (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      "default-tenant",
      "operator",
      "operator",
      "memory.vault.write",
      "memory_vault",
      "vault_artifact:v1",
      "tampered",
      JSON.stringify({ schemaVersion: 1, artifact_id: "v1" }),
      "2026-07-01T00:02:00.000Z"
    );

    const result = verifyMemoryAuditChain(database, "default-tenant");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/missing entryHash/);
  });

  it("sanitizes forbidden metadata keys (raw body / secrets / embeddings)", () => {
    const database = freshDb();
    writeChainedMemoryAuditEntry(database, {
      tenantId: "default-tenant",
      actorId: "operator",
      actorRole: "operator",
      eventType: "memory.vault.write",
      entityType: "memory_vault",
      entityId: "vault_artifact:v1",
      reason: "vault_write_succeeded",
      metadata: {
        artifact_id: "v1",
        raw_body: "TOP_SECRET_MEMORY_CONTENT",
        secret: "api-key-1234",
        embedding: [0.1, 0.2],
        evidence_examples: ["example text"],
        valid_field: "kept",
      },
    });

    const row = database.prepare("SELECT metadata_json FROM audit_entries WHERE event_type = ?").get("memory.vault.write") as { metadata_json: string };
    const parsed = JSON.parse(row.metadata_json);
    expect(parsed.raw_body).toBeUndefined();
    expect(parsed.secret).toBeUndefined();
    expect(parsed.embedding).toBeUndefined();
    expect(parsed.evidence_examples).toBeUndefined();
    expect(parsed.valid_field).toBe("kept");
    const serialized = row.metadata_json;
    expect(serialized).not.toContain("TOP_SECRET_MEMORY_CONTENT");
    expect(serialized).not.toContain("api-key-1234");
  });

  it("rejects eventType not in memory.* domain", () => {
    const database = freshDb();
    expect(() =>
      writeChainedMemoryAuditEntry(database, {
        tenantId: "default-tenant",
        actorId: "operator",
        actorRole: "operator",
        eventType: "skill.signed",
        entityType: "skill",
        entityId: "skill:s1",
        reason: "test",
        metadata: {},
      })
    ).toThrow(/must start with one of/);
  });

  it("simulateReceiptFailure aborts without committing the audit row", () => {
    const database = freshDb();
    const before = (database.prepare("SELECT COUNT(*) AS count FROM audit_entries").get() as { count: number }).count;
    expect(() =>
      writeChainedMemoryAuditEntry(
        database,
        {
          tenantId: "default-tenant",
          actorId: "operator",
          actorRole: "operator",
          eventType: "memory.tombstone.written",
          entityType: "memory_tombstone",
          entityId: "tombstone:t1",
          reason: "tombstone_written",
          metadata: { tombstone_id: "t1" },
        },
        { simulateReceiptFailure: true }
      )
    ).toThrow(/simulated receipt failure/);
    const after = (database.prepare("SELECT COUNT(*) AS count FROM audit_entries").get() as { count: number }).count;
    expect(after).toBe(before);
  });

  it("verifyMemoryAuditChainWithFault detects deletion via null corruptor", () => {
    const database = freshDb();
    writeChainedMemoryAuditEntry(database, {
      tenantId: "default-tenant",
      actorId: "operator",
      actorRole: "operator",
      eventType: "memory.consolidation.run",
      entityType: "memory_consolidation",
      entityId: "consolidation_run:con_1",
      reason: "consolidation_completed",
      metadata: { run_id: "con_1" },
    });

    const result = verifyMemoryAuditChainWithFault(database, "default-tenant", () => null);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/metadata missing or deleted/);
  });

  it("memoryAuditEntryHash is stable for fixed input", () => {
    const row = {
      id: "audit_1",
      tenantId: "t1",
      actorId: "a1",
      actorRole: "operator",
      eventType: "memory.consolidation.run",
      entityType: "memory_consolidation",
      entityId: "consolidation_run:1",
      reason: "test",
      metadata: { a: 1, b: 2 },
      createdAt: "2026-07-01T00:00:00.000Z",
    };
    const h1 = memoryAuditEntryHash(row);
    const h2 = memoryAuditEntryHash(row);
    expect(h1).toBe(h2);
    const different = { ...row, metadata: { a: 1, b: 3 } };
    expect(memoryAuditEntryHash(different)).not.toBe(h1);
  });

  it("verifyMemoryAuditChainWithFault detects missing entryHash", () => {
    const database = freshDb();
    writeChainedMemoryAuditEntry(database, {
      tenantId: "default-tenant",
      actorId: "operator",
      actorRole: "operator",
      eventType: "memory.consolidation.run",
      entityType: "memory_consolidation",
      entityId: "consolidation_run:missing-hash",
      reason: "consolidation_completed",
      metadata: { run_id: "missing-hash" },
      createdAt: "2026-07-01T00:00:00.000Z",
    });

    const result = verifyMemoryAuditChainWithFault(database, "default-tenant", (_row, metadata) => {
      const { entryHash: _drop, ...rest } = metadata;
      return rest;
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("missing entryHash");
  });

  it("buildMemoryAuditEntry rejects empty tenantId", () => {
    const database = freshDb();
    expect(() =>
      buildMemoryAuditEntry(database, {
        tenantId: "",
        actorId: "a",
        actorRole: "operator",
        eventType: "memory.consolidation.run",
        entityType: "memory_consolidation",
        entityId: "consolidation_run:1",
        reason: "test",
        metadata: {},
      })
    ).toThrow(/tenantId is required/);
  });
});
