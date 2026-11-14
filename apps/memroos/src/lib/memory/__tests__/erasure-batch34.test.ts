// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";
import { getErasureStoreAdapter, traverseIndirectDerivatives } from "../erasure";

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

describe("erasure batch34 — vault traversal, platform ids, malformed reports", () => {
  it("traverseIndirectDerivatives links raw_artifacts vault rows (316-324)", () => {
    const database = freshDb();
    const artifactId = `art-b34-${randomUUID().slice(0, 8)}`;
    const contentHash = randomUUID().replace(/-/g, "");
    database
      .prepare(
        `INSERT INTO raw_artifacts (id, tenant_id, source_type, artifact_uri, artifact_path, content_hash)
         VALUES (?, 'default-tenant', 'vault', ?, ?, ?)`,
      )
      .run(artifactId, `memroos://vault/${artifactId}`, `/vault/${artifactId}`, contentHash);
    const identity = buildCanonicalIdentity(artifactId, "vault", "ingress", "vault", {
      tenantId: "default-tenant",
    });
    identity.canonicalHash = contentHash;
    const indirect = traverseIndirectDerivatives(database, identity);
    expect(indirect.some((d) => d.storeId === "vault" && d.provenance.startsWith("raw_artifacts:"))).toBe(true);
  });

  it("traverseIndirectDerivatives skips malformed erasure report JSON (277-279)", () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity(`malformed-b34-${randomUUID().slice(0, 8)}`, "message", "ingress", "fts", {
      tenantId: "default-tenant",
    });
    database
      .prepare(
        `INSERT INTO memory_erasure_reports
         (id, tenant_id, canonical_id, status, store_outcomes_json, actor_id, scope_hash, started_at, completed_at)
         VALUES (?, 'default-tenant', ?, 'completed', ?, 'operator-b34', ?, ?, ?)`,
      )
      .run(
        `rep-mal-b34-${randomUUID().slice(0, 8)}`,
        identity.id,
        "{not-json",
        "scope-b34",
        "2026-03-04T00:00:00.000Z",
        "2026-03-04T00:00:01.000Z",
      );
    const indirect = traverseIndirectDerivatives(database, identity);
    expect(indirect.filter((d) => d.provenance === "erasure_report_snapshot")).toHaveLength(0);
  });

  it("resolveMessageIds collects platform_message_memory row ids (477-483)", async () => {
    const database = freshDb();
    const { ensureMessageMemorySchema } = await import("@/lib/message-memory/store");
    ensureMessageMemorySchema(database);
    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES (?, ?, ?, ?, ?, ?, 'internal', 'indexable')`,
      )
      .run(`sess-b34-${randomUUID()}`, "alpha", "agent", "user", "platform b34", "2026-03-04T00:00:00.000Z")
      .lastInsertRowid as number;
    const platformId = `plat-b34-${randomUUID().slice(0, 8)}`;
    const identity = buildCanonicalIdentity(platformId, "message", "ingress", "fts", {
      tenantId: "default-tenant",
    });
    database
      .prepare(
        `INSERT INTO platform_message_memory
         (id, dedupe_key, provider, workspace_id, channel_id, provider_message_id, author_id,
          content, content_hash, message_timestamp, message_row_id, metadata, created_at, updated_at)
         VALUES (?, ?, 'slack', 'ws', 'ch', 'pm', 'author', ?, ?, '2026-03-04T00:00:00.000Z', ?, '{}', '2026-03-04T00:00:00.000Z', '2026-03-04T00:00:00.000Z')`,
      )
      .run(platformId, identity.id, "body-b34", identity.canonicalHash, messageId);
    database
      .prepare(`INSERT INTO messages_fts(rowid, content, project, timestamp, agent_id) VALUES (?, ?, 'alpha', '2026-03-04T00:00:00.000Z', 'agent')`)
      .run(messageId, "platform indexed b34");
    identity.derivatives = [{ storeId: "fts", sourceHash: identity.canonicalHash, provenance: "batch34" }];
    const adapter = getErasureStoreAdapter("fts");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-fts-b34-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("purged");
  });

  it("purgeFtsRows purges when message row exists (503)", async () => {
    const database = freshDb();
    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(`sess-b34-${randomUUID()}`, "alpha", "agent", "user", "purge b34", "2026-03-04T00:00:00.000Z", "internal", "indexable")
      .lastInsertRowid as number;
    database
      .prepare(`INSERT INTO messages_fts(rowid, content, project, timestamp, agent_id) VALUES (?, ?, 'alpha', '2026-03-04T00:00:00.000Z', 'agent')`)
      .run(messageId, "purge fts b34");
    const identity = buildCanonicalIdentity(`purge-b34-${randomUUID().slice(0, 8)}`, "message", "ingress", "fts", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [
      {
        storeId: "fts",
        sourceHash: identity.canonicalHash,
        provenance: "batch34",
        metadata: { message_id: messageId },
      },
    ];
    const adapter = getErasureStoreAdapter("fts");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-purge-b34-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.metadata?.purged).toBe(1);
  });
});
