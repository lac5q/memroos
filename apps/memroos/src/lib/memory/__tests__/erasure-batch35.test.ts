// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";
import { registerRetentionRecord } from "@/lib/memory/retention-policy";
import { getErasureStoreAdapter } from "../erasure";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

afterEach(() => {
  vi.restoreAllMocks();
  db?.close();
  db = null;
});

describe("erasure batch35 — message id union, fts defer, platform hash", () => {
  it("resolveMessageIds unions and sorts multiple ledger ids (483)", async () => {
    const database = freshDb();
    const lowId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(`sess-b35-a-${randomUUID()}`, "alpha", "agent", "user", "low", "2026-03-05T00:00:00.000Z", "internal", "indexable")
      .lastInsertRowid as number;
    const highId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(`sess-b35-b-${randomUUID()}`, "alpha", "agent", "user", "high", "2026-03-05T00:00:00.000Z", "internal", "indexable")
      .lastInsertRowid as number;

    const identity = buildCanonicalIdentity(`union-b35-${randomUUID().slice(0, 8)}`, "message", "ingress", "fts", {
      tenantId: "default-tenant",
    });
    registerRetentionRecord(database, {
      recordType: "message",
      recordId: String(highId),
      ontologyType: "memory.note",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: {
        tenantId: "default-tenant",
        project: "alpha",
        canonicalMemoryId: identity.id,
      },
      contentHash: randomUUID(),
      actorId: "operator-b35",
      createdAt: "2026-03-05T00:00:00.000Z",
      now: new Date("2026-03-05T00:00:00.000Z"),
    });

    database
      .prepare(`INSERT INTO messages_fts(rowid, content, project, timestamp, agent_id) VALUES (?, ?, 'alpha', '2026-03-05T00:00:00.000Z', 'agent')`)
      .run(lowId, "low fts b35");
    database
      .prepare(`INSERT INTO messages_fts(rowid, content, project, timestamp, agent_id) VALUES (?, ?, 'alpha', '2026-03-05T00:00:00.000Z', 'agent')`)
      .run(highId, "high fts b35");

    identity.derivatives = [
      {
        storeId: "fts",
        sourceHash: identity.canonicalHash,
        provenance: "batch35",
        metadata: { message_id: lowId },
      },
    ];

    const adapter = getErasureStoreAdapter("fts");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-fts-b35-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("purged");
    expect(outcome.metadata?.purged).toBe(2);
    expect(outcome.metadata?.message_ids).toEqual([lowId, highId]);
  });

  it("platform_message_memory resolves ids by content_hash without message_row_id (473-479)", async () => {
    const database = freshDb();
    const { ensureMessageMemorySchema } = await import("@/lib/message-memory/store");
    ensureMessageMemorySchema(database);
    const platformId = `plat-b35-${randomUUID().slice(0, 8)}`;
    const identity = buildCanonicalIdentity(platformId, "message", "ingress", "fts", {
      tenantId: "default-tenant",
    });
    database
      .prepare(
        `INSERT INTO platform_message_memory
         (id, dedupe_key, provider, workspace_id, channel_id, provider_message_id, author_id,
          content, content_hash, message_timestamp, message_row_id, metadata, created_at, updated_at)
         VALUES (?, ?, 'slack', 'ws', 'ch', 'pm', 'author', ?, ?, '2026-03-05T00:00:00.000Z', NULL, '{}', '2026-03-05T00:00:00.000Z', '2026-03-05T00:00:00.000Z')`,
      )
      .run(platformId, `dedupe-b35-${randomUUID()}`, "body-b35", identity.canonicalHash);
    identity.derivatives = [{ storeId: "fts", sourceHash: identity.canonicalHash, provenance: "batch35" }];
    const adapter = getErasureStoreAdapter("fts");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-fts-hash-b35-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("zero_match");
    expect(outcome.metadata?.message_ids).toEqual([]);
  });

  it("fts erase defers when message store is also targeted (595-600)", async () => {
    const database = freshDb();
    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(`sess-b35-${randomUUID()}`, "alpha", "agent", "user", "defer fts", "2026-03-05T00:00:00.000Z", "internal", "indexable")
      .lastInsertRowid as number;
    database
      .prepare(`INSERT INTO messages_fts(rowid, content, project, timestamp, agent_id) VALUES (?, ?, 'alpha', '2026-03-05T00:00:00.000Z', 'agent')`)
      .run(messageId, "defer fts b35");
    const identity = buildCanonicalIdentity(`defer-b35-${randomUUID().slice(0, 8)}`, "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [
      { storeId: "message", sourceHash: identity.canonicalHash, provenance: "batch35" },
      {
        storeId: "fts",
        sourceHash: identity.canonicalHash,
        provenance: "batch35",
        metadata: { message_id: messageId },
      },
    ];
    const adapter = getErasureStoreAdapter("fts");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-defer-b35-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("tombstoned");
    expect(outcome.reason).toBe("fts_deferred_to_message_seal_triggers");
  });
});
