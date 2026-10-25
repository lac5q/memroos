// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  LocalMessageEmbeddingAdapter,
  getEmbeddingProvenance,
  listEmbeddingProvenanceForCanonical,
  markEmbeddingDegraded,
  markEmbeddingStale,
  registerEmbeddingProvenance,
  removeEmbeddingForCanonical,
} from "../embedding-lifecycle";

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

describe("embedding-lifecycle batch17 — erasure adapters and metadata edges", () => {
  it("listEmbeddingProvenance tolerates malformed metadata_json", () => {
    const database = freshDb();
    const canonicalId = `canon-meta-${crypto.randomUUID().slice(0, 8)}`;
    const id = `emb_${crypto.randomUUID().replace(/-/g, "").slice(0, 32)}`;
    database
      .prepare(
        `INSERT INTO memory_embedding_provenance
         (id, tenant_id, canonical_id, store_id, adapter_kind, source_hash, model_id, model_version,
          dimensionality, provenance, lifecycle_state, removability, metadata_json, created_at, updated_at)
         VALUES (?, 'default-tenant', ?, 'vector', 'local', ?, 'm1', NULL, 0, 'test', 'active', 'erasable', ?, ?, ?)`,
      )
      .run(id, canonicalId, "f".repeat(64), "{not-json", "2026-07-10T00:00:00.000Z", "2026-07-10T00:00:00.000Z");
    const rows = listEmbeddingProvenanceForCanonical(database, "default-tenant", canonicalId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metadata).toEqual({});
  });

  it("getEmbeddingProvenance returns null when provenance table is absent", () => {
    const database = freshDb();
    database.exec("DROP TABLE memory_embedding_provenance");
    expect(
      getEmbeddingProvenance(database, "default-tenant", "x", "vector", "m", "local"),
    ).toBeNull();
  });

  it("markEmbeddingStale and markEmbeddingDegraded no-op on removed rows", () => {
    const database = freshDb();
    const row = registerEmbeddingProvenance(database, {
      canonicalId: `canon-removed-${crypto.randomUUID().slice(0, 6)}`,
      storeId: "fts",
      sourceHash: "a".repeat(64),
      modelId: "m-removed",
      provenance: "batch17",
    });
    database
      .prepare(`UPDATE memory_embedding_provenance SET lifecycle_state = 'removed' WHERE id = ?`)
      .run(row.id);
    const stale = markEmbeddingStale(database, {
      tenantId: "default-tenant",
      id: row.id,
      reason: "ignored",
    });
    expect(stale?.lifecycleState).toBe("removed");
    const degraded = markEmbeddingDegraded(database, {
      tenantId: "default-tenant",
      id: row.id,
      reason: "ignored",
    });
    expect(degraded?.lifecycleState).toBe("removed");
  });

  it("removeEmbeddingForCanonical handles deferred, adapter errors, and zero_match", () => {
    const database = freshDb();
    const deferred = registerEmbeddingProvenance(database, {
      canonicalId: `canon-def-${crypto.randomUUID().slice(0, 6)}`,
      storeId: "vector",
      sourceHash: "b".repeat(64),
      modelId: "m-def",
      provenance: "batch17",
      removability: "deferred",
    });
    const tombstone = removeEmbeddingForCanonical(database, {
      tenantId: "default-tenant",
      row: deferred,
      erasureId: `er-${crypto.randomUUID()}`,
    });
    expect(tombstone.status).toBe("tombstoned");

    const erasable = registerEmbeddingProvenance(database, {
      canonicalId: `canon-adapter-${crypto.randomUUID().slice(0, 6)}`,
      storeId: "vector",
      sourceHash: "c".repeat(64),
      modelId: "m-ad",
      provenance: "batch17",
    });
    const mismatch = removeEmbeddingForCanonical(database, {
      tenantId: "default-tenant",
      row: erasable,
      erasureId: `er-${crypto.randomUUID()}`,
      adapter: { storeId: "fts", delete: () => true },
    });
    expect(mismatch.status).toBe("failed");

    const throwing = registerEmbeddingProvenance(database, {
      canonicalId: `canon-throw-${crypto.randomUUID().slice(0, 6)}`,
      storeId: "vector",
      sourceHash: "d".repeat(64),
      modelId: "m-th",
      provenance: "batch17",
    });
    const unavailable = removeEmbeddingForCanonical(database, {
      tenantId: "default-tenant",
      row: throwing,
      erasureId: `er-${crypto.randomUUID()}`,
      adapter: {
        storeId: "vector",
        delete: () => {
          throw new Error("vector_down");
        },
      },
    });
    expect(unavailable.status).toBe("unavailable");

    const zero = registerEmbeddingProvenance(database, {
      canonicalId: `canon-zero-${crypto.randomUUID().slice(0, 6)}`,
      storeId: "vector",
      sourceHash: "e".repeat(64),
      modelId: "m-zero",
      provenance: "batch17",
    });
    const zeroMatch = removeEmbeddingForCanonical(database, {
      tenantId: "default-tenant",
      row: zero,
      erasureId: `er-${crypto.randomUUID()}`,
      adapter: { storeId: "vector", delete: () => false },
    });
    expect(zeroMatch.status).toBe("zero_match");
  });

  it("LocalMessageEmbeddingAdapter deletes by message_id metadata", () => {
    const database = freshDb();
    database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES ('s1', 'p', 'a', 'user', 'hello', '2026-01-01T00:00:00.000Z', 'internal', 'indexable')`,
      )
      .run();
    const messageId = Number(database.prepare("SELECT id FROM messages LIMIT 1").get()?.id);
    database
      .prepare(`INSERT INTO message_embeddings (message_id, model, dim, vector) VALUES (?, ?, ?, ?)`)
      .run(messageId, "text-embedding-test", 3, Buffer.from(Float32Array.from([0.1, 0.2, 0.3]).buffer));
    const row = registerEmbeddingProvenance(database, {
      canonicalId: `canon-msg-${crypto.randomUUID().slice(0, 6)}`,
      storeId: "vector",
      sourceHash: "g".repeat(64),
      modelId: "m-msg",
      provenance: "batch17",
      metadata: { message_id: messageId },
    });
    const adapter = new LocalMessageEmbeddingAdapter(database, "vector");
    expect(adapter.delete("default-tenant", row)).toBe(true);
    expect(database.prepare("SELECT COUNT(*) AS c FROM message_embeddings").get()).toEqual({ c: 0 });
  });
});
