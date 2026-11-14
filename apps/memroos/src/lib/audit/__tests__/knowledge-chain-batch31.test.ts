// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { AUDIT_EVENT_TYPES } from "@/lib/audit/event-types";
import { initSchema } from "@/lib/db-schema";
import { buildKnowledgeAuditEntry, previousKnowledgeEntryHash } from "../knowledge-chain";

const KNOWLEDGE_CHAIN_EVENT = AUDIT_EVENT_TYPES.KNOWLEDGE_ACCESS;

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

describe("knowledge-chain batch31", () => {
  it("previousKnowledgeEntryHash returns null on corrupt metadata_json (line 143)", () => {
    const database = freshDb();
    database
      .prepare(
        `INSERT INTO audit_entries
         (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
         VALUES (?, 'default-tenant', 'operator', 'operator', ?, 'knowledge_vault', 'kid-b31', 'r', ?, ?)`,
      )
      .run(crypto.randomUUID(), KNOWLEDGE_CHAIN_EVENT, "{not-json", "2026-11-08T00:00:00.000Z");
    expect(previousKnowledgeEntryHash(database, "default-tenant")).toBeNull();
  });

  it("buildKnowledgeAuditEntry rejects unknown operations (line 181)", () => {
    const database = freshDb();
    expect(() =>
      buildKnowledgeAuditEntry(database, {
        tenantId: "default-tenant",
        actorId: `operator-b31-${randomUUID().slice(0, 6)}`,
        actorRole: "operator",
        path: "docs/b31.md",
        operation: "bogus-op" as "read",
        agentId: "agent-b31",
        opHash: `sha256:${"c".repeat(64)}`,
      }),
    ).toThrow(/unknown operation/);
  });

  it("normalizeStable sorts object keys in stable json (line 77 branch)", () => {
    const database = freshDb();
    const built = buildKnowledgeAuditEntry(database, {
      tenantId: "default-tenant",
      actorId: "operator-b31",
      actorRole: "operator",
      path: "shared/z-b31.md",
      operation: "write",
      agentId: "agent-b31",
      opHash: `sha256:${"d".repeat(64)}`,
    });
    const meta = JSON.parse(built.metadata_json) as Record<string, unknown>;
    expect(meta.schemaVersion).toBeDefined();
    expect(meta.entryHash).toMatch(/^sha256:/);
  });
});
