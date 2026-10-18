import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  registerEmbeddingProvenance,
  getEmbeddingProvenance,
  listEmbeddingProvenanceForCanonical,
  markEmbeddingStale,
  markEmbeddingDegraded,
  removeEmbeddingForCanonical,
  LocalMessageEmbeddingAdapter,
  type EmbeddingLifecycleAdapter,
} from "../embedding-lifecycle";

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE memory_embedding_provenance (
      id                 TEXT PRIMARY KEY,
      tenant_id          TEXT NOT NULL DEFAULT 'default-tenant',
      canonical_id       TEXT NOT NULL,
      store_id           TEXT NOT NULL,
      adapter_kind       TEXT NOT NULL DEFAULT 'local'
                         CHECK(adapter_kind IN ('local','external','cache','snapshot')),
      source_hash        TEXT NOT NULL,
      model_id           TEXT NOT NULL,
      model_version      TEXT,
      dimensionality     INTEGER NOT NULL DEFAULT 0,
      provenance         TEXT NOT NULL,
      lifecycle_state    TEXT NOT NULL DEFAULT 'active'
                         CHECK(lifecycle_state IN ('active','stale','degraded','removed','tombstoned')),
      removability       TEXT NOT NULL DEFAULT 'erasable'
                         CHECK(removability IN ('erasable','retained','deferred')),
      external_ref       TEXT,
      last_refreshed_at  TEXT,
      metadata_json      TEXT NOT NULL DEFAULT '{}',
      erasure_id         TEXT,
      removed_at         TEXT,
      created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      UNIQUE(tenant_id, canonical_id, store_id, model_id, adapter_kind)
    );
  `);
  return db;
}

describe("VAL-MEM-011: embedding lifecycle is provenance-linked and removable", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = freshDb();
  });

  it("registerEmbeddingProvenance records canonical_id, model_id, model_version, source_hash", () => {
    const row = registerEmbeddingProvenance(db, {
      tenantId: "tenant1",
      canonicalId: "canon-abc",
      storeId: "vector",
      sourceHash: "h1",
      modelId: "text-embed-3-small",
      modelVersion: "1.0.0",
      dimensionality: 1536,
      provenance: "ingress/test",
    });

    expect(row.canonicalId).toBe("canon-abc");
    expect(row.modelId).toBe("text-embed-3-small");
    expect(row.modelVersion).toBe("1.0.0");
    expect(row.sourceHash).toBe("h1");
    expect(row.dimensionality).toBe(1536);
    expect(row.lifecycleState).toBe("active");
    expect(row.removability).toBe("erasable");
  });

  it("registration is idempotent on (tenant, canonical, store, model, adapter_kind)", () => {
    registerEmbeddingProvenance(db, {
      tenantId: "tenant1",
      canonicalId: "canon-abc",
      storeId: "vector",
      sourceHash: "h1",
      modelId: "model-1",
      provenance: "ingress/test",
    });
    registerEmbeddingProvenance(db, {
      tenantId: "tenant1",
      canonicalId: "canon-abc",
      storeId: "vector",
      sourceHash: "h2",
      modelId: "model-1",
      provenance: "ingress/test",
    });

    const rows = listEmbeddingProvenanceForCanonical(db, "tenant1", "canon-abc");
    expect(rows.length).toBe(1);
    expect(rows[0].sourceHash).toBe("h2"); // updated
  });

  it("markEmbeddingStale moves state to stale without erasing the row", () => {
    const row = registerEmbeddingProvenance(db, {
      tenantId: "tenant1",
      canonicalId: "canon-abc",
      storeId: "vector",
      sourceHash: "h1",
      modelId: "model-1",
      provenance: "ingress/test",
    });
    const refreshed = markEmbeddingStale(db, {
      tenantId: "tenant1",
      id: row.id,
      reason: "provider_outage",
    });
    expect(refreshed).not.toBeNull();
    expect(refreshed!.lifecycleState).toBe("stale");
    // Verify via list that the row is now stale.
    const rows = listEmbeddingProvenanceForCanonical(db, "tenant1", "canon-abc");
    expect(rows[0].lifecycleState).toBe("stale");
  });

  it("markEmbeddingDegraded moves state to degraded", () => {
    registerEmbeddingProvenance(db, {
      tenantId: "tenant1",
      canonicalId: "canon-abc",
      storeId: "vector",
      sourceHash: "h1",
      modelId: "model-1",
      provenance: "ingress/test",
    });
    markEmbeddingDegraded(db, {
      tenantId: "tenant1",
      id: listEmbeddingProvenanceForCanonical(db, "tenant1", "canon-abc")[0].id,
      reason: "partial_corruption",
    });
    const rows = listEmbeddingProvenanceForCanonical(db, "tenant1", "canon-abc");
    expect(rows[0].lifecycleState).toBe("degraded");
  });

  it("removeEmbeddingForCanonical wires removability to erasure", () => {
    const row = registerEmbeddingProvenance(db, {
      tenantId: "tenant1",
      canonicalId: "canon-abc",
      storeId: "vector",
      sourceHash: "h1",
      modelId: "model-1",
      provenance: "ingress/test",
    });
    const result = removeEmbeddingForCanonical(db, {
      tenantId: "tenant1",
      row,
      erasureId: "erasure_test_1",
    });
    // Default outcome (no adapter) is `purged`; lifecycle_state becomes `removed`.
    expect(result.status).toBe("purged");
    expect(result.row.erasureId).toBe("erasure_test_1");
    expect(result.row.lifecycleState).toBe("removed");
  });

  it("removeEmbeddingForCanonical with retained removability is skipped", () => {
    const row = registerEmbeddingProvenance(db, {
      tenantId: "tenant1",
      canonicalId: "canon-abc",
      storeId: "vector",
      sourceHash: "h1",
      modelId: "model-1",
      provenance: "ingress/test",
      removability: "retained",
    });
    const result = removeEmbeddingForCanonical(db, {
      tenantId: "tenant1",
      row,
      erasureId: "erasure_test_2",
    });
    expect(result.status).toBe("skipped_retained");
    expect(result.row.lifecycleState).toBe("active");
  });

  it("LocalMessageEmbeddingAdapter removes local message_embeddings when message_id is provided", () => {
    db.exec(`
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY,
        session_id TEXT,
        content TEXT,
        project TEXT,
        agent_id TEXT,
        role TEXT,
        timestamp TEXT
      );
      CREATE TABLE message_embeddings (
        message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        dim INTEGER NOT NULL,
        vector BLOB NOT NULL
      );
      INSERT INTO messages(id, session_id, content, project, agent_id, role, timestamp)
      VALUES (42, 's', 'x', 'p', 'a', 'user', '2026-01-01T00:00:00Z');
      INSERT INTO message_embeddings(message_id, model, dim, vector)
      VALUES (42, 'model-1', 4, X'00000000');
    `);
    const row = registerEmbeddingProvenance(db, {
      tenantId: "tenant1",
      canonicalId: "canon-abc",
      storeId: "vector",
      sourceHash: "h1",
      modelId: "model-1",
      provenance: "ingress/test",
      metadata: { message_id: 42 },
    });
    const adapter: EmbeddingLifecycleAdapter = new LocalMessageEmbeddingAdapter(db, "vector");
    const result = removeEmbeddingForCanonical(db, {
      tenantId: "tenant1",
      row,
      erasureId: "erasure_test_3",
      adapter,
    });
    expect(result.status).toBe("purged");
    const rowCount = db.prepare("SELECT COUNT(*) AS count FROM message_embeddings").get() as { count: number };
    expect(rowCount.count).toBe(0);
  });

  it("getEmbeddingProvenance returns null when the row is absent", () => {
    const result = getEmbeddingProvenance(db, "tenant1", "missing", "vector", "model-1", "local");
    expect(result).toBeNull();
  });

  it("registerEmbeddingProvenance throws when the provenance table is missing", () => {
    const bare = new Database(":memory:");
    expect(() =>
      registerEmbeddingProvenance(bare, {
        canonicalId: "c1",
        storeId: "vector",
        sourceHash: "h1",
        modelId: "m1",
        provenance: "test",
      })
    ).toThrow(/memory_embedding_provenance table is missing/);
    bare.close();
  });

  it("removeEmbeddingForCanonical tombstones deferred removability without calling adapters", () => {
    const row = registerEmbeddingProvenance(db, {
      tenantId: "tenant1",
      canonicalId: "canon-deferred",
      storeId: "vector",
      sourceHash: "h1",
      modelId: "model-1",
      provenance: "ingress/test",
      removability: "deferred",
    });
    const result = removeEmbeddingForCanonical(db, {
      tenantId: "tenant1",
      row,
      erasureId: "erasure_deferred",
    });
    expect(result.status).toBe("tombstoned");
    expect(result.reason).toBe("deferred_tombstoned");
    const refreshed = getEmbeddingProvenance(db, "tenant1", "canon-deferred", "vector", "model-1", "local");
    expect(refreshed?.lifecycleState).toBe("tombstoned");
  });

  it("removeEmbeddingForCanonical reports unavailable when adapter delete throws", () => {
    const row = registerEmbeddingProvenance(db, {
      tenantId: "tenant1",
      canonicalId: "canon-throw",
      storeId: "vector",
      sourceHash: "h1",
      modelId: "model-1",
      provenance: "ingress/test",
    });
    const adapter: EmbeddingLifecycleAdapter = {
      storeId: "vector",
      delete() {
        throw new Error("adapter offline");
      },
    };
    const result = removeEmbeddingForCanonical(db, {
      tenantId: "tenant1",
      row,
      erasureId: "erasure_throw",
      adapter,
    });
    expect(result.status).toBe("unavailable");
    expect(result.reason).toContain("adapter offline");
  });

  it("removeEmbeddingForCanonical fails on adapter store mismatch", () => {
    const row = registerEmbeddingProvenance(db, {
      tenantId: "tenant1",
      canonicalId: "canon-mismatch",
      storeId: "vector",
      sourceHash: "h1",
      modelId: "model-1",
      provenance: "ingress/test",
    });
    const adapter: EmbeddingLifecycleAdapter = {
      storeId: "embeddings",
      delete: () => true,
    };
    const result = removeEmbeddingForCanonical(db, {
      tenantId: "tenant1",
      row,
      erasureId: "erasure_mismatch",
      adapter,
    });
    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/adapter_store_mismatch/);
  });

  it("markEmbeddingStale is a no-op for removed provenance rows", () => {
    const row = registerEmbeddingProvenance(db, {
      tenantId: "tenant1",
      canonicalId: "canon-removed",
      storeId: "vector",
      sourceHash: "h1",
      modelId: "model-1",
      provenance: "ingress/test",
    });
    db.prepare(
      `UPDATE memory_embedding_provenance SET lifecycle_state = 'removed' WHERE id = ?`
    ).run(row.id);
    const stale = markEmbeddingStale(db, { tenantId: "tenant1", id: row.id, reason: "late stale" });
    expect(stale?.lifecycleState).toBe("removed");
  });

  it("listEmbeddingProvenanceForCanonical returns empty when table is absent", () => {
    const bare = new Database(":memory:");
    expect(listEmbeddingProvenanceForCanonical(bare, "tenant1", "missing")).toEqual([]);
    bare.close();
  });
});
