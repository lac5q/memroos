// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  buildMemoryAuditEntry,
  memoryAuditEntryHash,
  previousMemoryEntryHash,
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

describe("memory-chain batch17 — normalization, sanitization, fault verification", () => {
  it("memoryAuditEntryHash normalizes nested arrays in metadata", () => {
    const hash = memoryAuditEntryHash({
      id: "audit-1",
      tenantId: "default-tenant",
      actorId: "operator",
      actorRole: "operator",
      eventType: "memory.vault.replay",
      entityType: "memory_vault",
      entityId: "vault_artifact:art-1",
      reason: "test",
      metadata: { tags: ["b", "a"], nested: { z: 1, a: 2 } },
      createdAt: "2026-07-10T00:00:00.000Z",
    });
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("buildMemoryAuditEntry strips forbidden long content fields from metadata", () => {
    const database = freshDb();
    const built = buildMemoryAuditEntry(database, {
      tenantId: "default-tenant",
      actorId: "operator",
      actorRole: "operator",
      eventType: "memory.vault.write",
      entityType: "memory_vault",
      entityId: "vault_artifact:art-2",
      metadata: {
        email_body: "x".repeat(600),
        note: "safe",
      },
    });
    const parsed = JSON.parse(built.metadata_json) as Record<string, unknown>;
    expect(parsed.email_body).toBeUndefined();
    expect(parsed.note).toBe("safe");
  });

  it("previousMemoryEntryHash returns null when metadata_json is invalid JSON", () => {
    const database = freshDb();
    database
      .prepare(
        `INSERT INTO audit_entries
         (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
         VALUES (?, 'default-tenant', 'operator', 'operator', 'memory.vault.write', 'memory_vault', 'x', 'r', ?, ?)`,
      )
      .run(crypto.randomUUID(), "{bad", "2026-07-10T00:00:00.000Z");
    expect(previousMemoryEntryHash(database, "default-tenant")).toBeNull();
  });

  it("verifyMemoryAuditChainWithFault detects broken previousEntryHash links", () => {
    const database = freshDb();
    writeChainedMemoryAuditEntry(database, {
      tenantId: "default-tenant",
      actorId: "operator",
      actorRole: "operator",
      eventType: "memory.consolidation.run",
      entityType: "memory_consolidation",
      entityId: "consolidation_run:one",
      reason: "ok",
      metadata: { run_id: "one" },
      createdAt: "2026-07-10T00:00:00.000Z",
    });
    writeChainedMemoryAuditEntry(database, {
      tenantId: "default-tenant",
      actorId: "operator",
      actorRole: "operator",
      eventType: "memory.consolidation.run",
      entityType: "memory_consolidation",
      entityId: "consolidation_run:two",
      reason: "ok",
      metadata: { run_id: "two" },
      createdAt: "2026-07-10T00:00:01.000Z",
    });
    const result = verifyMemoryAuditChainWithFault(database, "default-tenant", (_row, metadata) => ({
      ...metadata,
      previousEntryHash: "sha256:broken",
    }));
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/previousEntryHash does not match/);
  });

  it("verifyMemoryAuditChainWithFault flags invalid metadata_json", () => {
    const database = freshDb();
    database
      .prepare(
        `INSERT INTO audit_entries
         (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
         VALUES (?, 'default-tenant', 'operator', 'operator', 'memory.vault.write', 'memory_vault', 'x', 'r', ?, ?)`,
      )
      .run(crypto.randomUUID(), "not-json", "2026-07-10T00:00:00.000Z");
    const result = verifyMemoryAuditChainWithFault(database, "default-tenant", undefined);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("metadata_json is not valid JSON");
  });
});
