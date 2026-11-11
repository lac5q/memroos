// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";
import { getErasureStoreAdapter } from "../erasure";

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

describe("erasure batch31 — resolveMessageIds and purgeFtsRows branches", () => {
  it("resolveMessageIds unions platform rows matched by canonical id / dedupe_key (line 483)", async () => {
    const database = freshDb();
    const { ensureMessageMemorySchema } = await import("@/lib/message-memory/store");
    ensureMessageMemorySchema(database);

    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES (?, ?, ?, ?, ?, ?, 'internal', 'indexable')`,
      )
      .run(`sess-${randomUUID()}`, "alpha", "agent", "user", "plat-id-b31", "2026-03-01T00:00:00.000Z")
      .lastInsertRowid as number;

    const platformId = `plat-b31-${randomUUID().slice(0, 8)}`;
    const identity = buildCanonicalIdentity(platformId, "message", "ingress", "fts", {
      tenantId: "default-tenant",
    });

    database
      .prepare(
        `INSERT INTO platform_message_memory
         (id, dedupe_key, provider, workspace_id, channel_id, provider_message_id, author_id,
          content, content_hash, message_timestamp, message_row_id, metadata, created_at, updated_at)
         VALUES (?, ?, 'slack', 'ws', 'ch', 'pm', 'author', ?, ?, '2026-03-01T00:00:00.000Z', ?, '{}', '2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z')`,
      )
      .run(platformId, platformId, "body-b31", identity.canonicalHash, messageId);

    database
      .prepare(`INSERT INTO messages_fts(rowid, content, project, timestamp, agent_id) VALUES (?, ?, 'alpha', '2026-03-01T00:00:00.000Z', 'agent')`)
      .run(messageId, "plat-id-b31 indexed");

    identity.derivatives = [
      { storeId: "fts", sourceHash: identity.canonicalHash, provenance: "batch31" },
    ];

    const adapter = getErasureStoreAdapter("fts");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-fts-b31-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("purged");
    expect(outcome.metadata?.purged).toBe(1);
  });

  it("resolveMessageIds ignores platform rows with invalid message_row_id", async () => {
    const database = freshDb();
    const { ensureMessageMemorySchema } = await import("@/lib/message-memory/store");
    ensureMessageMemorySchema(database);

    const ghostHash = buildCanonicalIdentity(`ghost-b31-${randomUUID().slice(0, 6)}`, "message", "ingress", "fts").canonicalHash;
    database
      .prepare(
        `INSERT INTO platform_message_memory
         (id, dedupe_key, provider, workspace_id, channel_id, provider_message_id, author_id,
          content, content_hash, message_timestamp, message_row_id, metadata, created_at, updated_at)
         VALUES (?, ?, 'slack', 'ws', 'ch', 'pm', 'author', ?, ?, '2026-03-01T00:00:00.000Z', ?, '{}', '2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z')`,
      )
      .run(`plat-null-b31-${randomUUID().slice(0, 6)}`, `dedupe-null-b31`, "null-row", ghostHash, null);

    const identity = buildCanonicalIdentity(`orphan-b31-${randomUUID().slice(0, 6)}`, "message", "ingress", "fts", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "fts", sourceHash: ghostHash, provenance: "batch31" }];

    const adapter = getErasureStoreAdapter("fts");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-fts-null-b31-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("zero_match");
  });

  it("purgeFtsRows deletes index rows when message row still exists (line 503 continue vs purge)", async () => {
    const database = freshDb();
    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(`sess-${randomUUID()}`, "alpha", "agent", "user", "fts-purge-b31", "2026-03-01T00:00:00.000Z", "internal", "indexable")
      .lastInsertRowid as number;

    database
      .prepare(`INSERT INTO messages_fts(rowid, content, project, timestamp, agent_id) VALUES (?, ?, 'alpha', '2026-03-01T00:00:00.000Z', 'agent')`)
      .run(messageId, "indexed purge b31");

    const identity = buildCanonicalIdentity("fts-purge-b31", "message", "ingress", "fts", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [
      {
        storeId: "fts",
        sourceHash: identity.canonicalHash,
        provenance: "batch31",
        metadata: { message_id: messageId },
      },
    ];

    const adapter = getErasureStoreAdapter("fts");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-fts-purge-b31-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("purged");
    expect(outcome.reason).toBe("messages_fts_rows_deleted");
    expect(outcome.metadata?.purged).toBe(1);
  });
});
