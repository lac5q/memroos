// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildKnowledgeAuditEntry } from "@/lib/audit/knowledge-chain";
import { writeAuditEntry } from "@/lib/audit/write";
import { listVaultPathsForUser } from "../dsar-export";

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

describe("dsar-export batch16b — vault path discovery", () => {
  function seedKnowledgeWrite(
    database: Database.Database,
    opts: { userId: string; path: string; operation: "write" | "read" | "delete" },
  ): void {
    const entry = buildKnowledgeAuditEntry(database, {
      tenantId: "default-tenant",
      actorId: "operator-1",
      actorRole: "operator",
      path: opts.path,
      operation: opts.operation,
      agentId: "agent-1",
      userId: opts.userId,
      opHash: `sha256:${crypto.createHash("sha256").update(opts.path).digest("hex")}`,
    });
    writeAuditEntry(
      {
        id: entry.id,
        tenant_id: entry.tenantId,
        actor_id: entry.actorId,
        actor_role: entry.actorRole,
        event_type: entry.eventType,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        reason: entry.reason,
        metadata_json: entry.metadata_json,
        created_at: entry.created_at,
      },
      database,
    );
  }

  it("listVaultPathsForUser collects write/read/delete knowledge paths", () => {
    const database = freshDb();
    const userId = `user-${crypto.randomUUID().slice(0, 8)}`;
    seedKnowledgeWrite(database, { userId, path: "notes/a.md", operation: "write" });
    seedKnowledgeWrite(database, { userId, path: "notes/b.md", operation: "read" });
    seedKnowledgeWrite(database, { userId, path: "../escape.md", operation: "write" });
    seedKnowledgeWrite(database, { userId: "other-user", path: "notes/other.md", operation: "write" });
    const paths = listVaultPathsForUser(database, "default-tenant", userId);
    expect(paths).toEqual(["../escape.md", "notes/a.md", "notes/b.md"]);
  });

  it("listVaultPathsForUser ignores malformed metadata", () => {
    const database = freshDb();
    database
      .prepare(
        `INSERT INTO audit_entries
         (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
         VALUES (?, 'default-tenant', 'u1', 'operator', 'knowledge.access', 'knowledge', 'k1', NULL, ?, ?)`,
      )
      .run(`audit-bad-${crypto.randomUUID()}`, "{not-json", "2026-07-01T00:00:00.000Z");
    expect(listVaultPathsForUser(database, "default-tenant", "u1")).toEqual([]);
  });
});
