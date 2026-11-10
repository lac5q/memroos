// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { AUDIT_EVENT_TYPES } from "@/lib/audit/event-types";
import { initSchema } from "@/lib/db-schema";
import { buildKnowledgeAuditEntry, verifyKnowledgeAuditChain } from "../knowledge-chain";
import { writeAuditEntry } from "../write";

const KNOWLEDGE_CHAIN_EVENT = AUDIT_EVENT_TYPES.KNOWLEDGE_ACCESS;

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

function insertBuilt(database: Database.Database, built: ReturnType<typeof buildKnowledgeAuditEntry>): void {
  writeAuditEntry(
    {
      id: built.id,
      tenant_id: built.tenantId,
      actor_id: built.actorId,
      actor_role: built.actorRole,
      event_type: built.eventType,
      entity_type: built.entityType,
      entity_id: built.entityId,
      reason: built.reason,
      metadata_json: built.metadata_json,
      created_at: built.created_at,
    },
    database,
  );
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("knowledge-chain batch17 — verification fault paths", () => {
  it("verifyKnowledgeAuditChain flags invalid metadata_json", () => {
    const database = freshDb();
    database
      .prepare(
        `INSERT INTO audit_entries
         (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
         VALUES (?, 'default-tenant', 'operator', 'operator', ?, 'knowledge_vault', 'kid-1', 'r', ?, ?)`,
      )
      .run(crypto.randomUUID(), KNOWLEDGE_CHAIN_EVENT, "{bad", "2026-07-10T00:00:00.000Z");
    const result = verifyKnowledgeAuditChain(database, "default-tenant");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("metadata_json is not valid JSON");
  });

  it("verifyKnowledgeAuditChain detects broken previousEntryHash on appended row", () => {
    const database = freshDb();
    const first = buildKnowledgeAuditEntry(database, {
      tenantId: "default-tenant",
      actorId: "operator",
      actorRole: "operator",
      path: "docs/a.md",
      operation: "write",
      agentId: "agent-1",
      opHash: `sha256:${"a".repeat(64)}`,
      createdAt: "2026-07-10T00:00:00.000Z",
    });
    insertBuilt(database, first);
    const firstMeta = JSON.parse(first.metadata_json) as Record<string, unknown>;
    database
      .prepare(
        `INSERT INTO audit_entries
         (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
         VALUES (?, 'default-tenant', 'operator', 'operator', ?, 'knowledge_vault', 'knowledge_vault:default-tenant', 'broken', ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        KNOWLEDGE_CHAIN_EVENT,
        JSON.stringify({
          ...firstMeta,
          path: "docs/b.md",
          operation: "read",
          previousEntryHash: "sha256:broken-link",
          entryHash: "sha256:also-broken",
        }),
        "2026-07-10T00:00:01.000Z",
      );
    const result = verifyKnowledgeAuditChain(database, "default-tenant");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/previousEntryHash does not match/);
  });
});
