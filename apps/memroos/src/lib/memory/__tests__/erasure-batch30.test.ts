// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";
import { registerEmbeddingProvenance } from "@/lib/memory/embedding-lifecycle";
import { coordinateErasure, getErasureStoreAdapter, traverseIndirectDerivatives } from "../erasure";

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

describe("erasure batch30 — cluster B uncovered statements", () => {
  it("traverseIndirectDerivatives skips implicit cache link when ledger already owns cache:indirect (line 338)", () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("indirect-dedupe-b30", "message", "ingress", "vector");
    const now = "2026-02-01T00:00:00.000Z";
    database
      .prepare(
        `INSERT INTO memory_embedding_provenance
         (id, tenant_id, canonical_id, store_id, adapter_kind, source_hash, model_id, model_version,
          dimensionality, provenance, lifecycle_state, removability, metadata_json, created_at, updated_at)
         VALUES (?, 'default-tenant', ?, 'cache', 'cache', 'indirect', 'm1', '1.0', 0, 'ledger-b30', 'active', 'erasable', '{}', ?, ?)`,
      )
      .run(`emb-b30-${randomUUID().slice(0, 8)}`, identity.id, now, now);

    const indirect = traverseIndirectDerivatives(database, identity);
    const cacheLinks = indirect.filter((d) => d.storeId === "cache");
    expect(cacheLinks).toHaveLength(1);
    expect(cacheLinks[0]?.provenance).toMatch(/^embedding_provenance:/);
    expect(indirect.some((d) => d.storeId === "context" && d.provenance === "implicit_neighbor_link")).toBe(true);
  });

  it("resolveMessageIds union includes platform_message_memory row ids (line 483)", async () => {
    const database = freshDb();
    const { ensureMessageMemorySchema } = await import("@/lib/message-memory/store");
    ensureMessageMemorySchema(database);
    const messageId = Number(
      database
        .prepare(
          `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
           VALUES (?, ?, ?, ?, ?, ?, 'internal', 'indexable')`,
        )
        .run(`sess-${randomUUID()}`, "alpha", "agent", "user", "platform-b30", "2026-02-01T00:00:00.000Z")
        .lastInsertRowid,
    );
    const platformId = `plat-b30-${randomUUID().slice(0, 8)}`;
    database
      .prepare(
        `INSERT INTO platform_message_memory
         (id, dedupe_key, provider, workspace_id, channel_id, provider_message_id, author_id,
          content, content_hash, message_timestamp, message_row_id, metadata, created_at, updated_at)
         VALUES (?, ?, 'slack', 'ws', 'ch', 'pm', 'author', ?, ?, '2026-02-01T00:00:00.000Z', ?, '{}', '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z')`,
      )
      .run(platformId, `dedupe-${platformId}`, "platform-b30 body", buildCanonicalIdentity("platform-b30 body", "message", "ingress", "fts").canonicalHash, messageId);

    const identity = buildCanonicalIdentity("platform-b30 body", "message", "ingress", "fts", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [
      { storeId: "fts", sourceHash: identity.canonicalHash, provenance: "batch30", metadata: { message_id: messageId } },
    ];

    const adapter = getErasureStoreAdapter("fts");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-fts-plat-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("purged");
  });

  it("fts purge skips orphan fts rowids when message row is gone (line 503)", async () => {
    const database = freshDb();
    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(`sess-${randomUUID()}`, "alpha", "agent", "user", "orphan-fts-b30", "2026-02-01T00:00:00.000Z", "internal", "indexable")
      .lastInsertRowid as number;

    database
      .prepare(`INSERT INTO messages_fts(rowid, content, project, timestamp, agent_id) VALUES (?, ?, 'alpha', '2026-02-01T00:00:00.000Z', 'agent')`)
      .run(messageId, "orphan index");
    database.prepare(`DELETE FROM messages WHERE id = ?`).run(messageId);

    const identity = buildCanonicalIdentity("orphan-fts-b30", "message", "ingress", "fts", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [
      {
        storeId: "fts",
        sourceHash: identity.canonicalHash,
        provenance: "batch30",
        metadata: { message_id: messageId },
      },
    ];

    const adapter = getErasureStoreAdapter("fts");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-fts-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("zero_match");
    expect(outcome.reason).toMatch(/fts|deleted|zero/i);
  });

  it("embeddings adapter increments purged counter when adapter deletes projection (line 1081)", async () => {
    const database = freshDb();
    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(`sess-${randomUUID()}`, "alpha", "agent", "user", "emb-b30", "2026-02-01T00:00:00.000Z", "internal", "indexable")
      .lastInsertRowid as number;
    database
      .prepare(`INSERT INTO message_embeddings (message_id, model, dim, vector) VALUES (?, ?, ?, ?)`)
      .run(messageId, "model-b30", 1, Buffer.from(new Float32Array([0.25]).buffer));

    const identity = buildCanonicalIdentity(`emb-b30-${randomUUID().slice(0, 6)}`, "message", "ingress", "embeddings", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "embeddings", sourceHash: identity.canonicalHash, provenance: "batch30" }];
    registerEmbeddingProvenance(database, {
      tenantId: "default-tenant",
      canonicalId: identity.id,
      storeId: "embeddings",
      sourceHash: identity.canonicalHash,
      modelId: "model-b30",
      provenance: "batch30",
      metadata: { message_id: messageId },
    });

    const adapter = getErasureStoreAdapter("embeddings");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-emb-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("purged");
    expect(outcome.reason).toBe("embedding_removed:1");
  });

  it("coordinateErasure rethrows persist errors that are not missing-table (line 1309)", async () => {
    vi.resetModules();
    vi.doMock("@/lib/audit/write", async () => {
      const actual = await vi.importActual<typeof import("@/lib/audit/write")>("@/lib/audit/write");
      return {
        ...actual,
        writeAuditEntry: () => {
          throw new Error("audit_constraint_failed_batch30");
        },
      };
    });
    const { coordinateErasure: coordinateWithMockedAudit } = await import("../erasure");
    const database = freshDb();
    const identity = buildCanonicalIdentity(`persist-err-b30-${randomUUID().slice(0, 6)}`, "document", "ingress", "qmd", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "qmd", sourceHash: identity.canonicalHash, provenance: "batch30" }];

    await expect(
      coordinateWithMockedAudit(database, identity, {
        tenantId: "default-tenant",
        actorId: "operator-b30",
        scope: { tenantId: "default-tenant" },
        idempotencyKey: `er-err-${randomUUID()}`,
      }),
    ).rejects.toThrow();
    vi.doUnmock("@/lib/audit/write");
    vi.resetModules();
  });
});
