// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import * as embeddingLifecycle from "../embedding-lifecycle";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

afterEach(() => {
  db?.close();
  db = null;
  vi.restoreAllMocks();
});

describe("embedding-lifecycle batch20 — fallback row materialization and missing-table guards", () => {
  it("registerEmbeddingProvenance synthesizes row when post-insert lookup misses", () => {
    const database = freshDb();
    const canonicalId = `canon-fallback-${crypto.randomUUID().slice(0, 8)}`;
    vi.spyOn(embeddingLifecycle, "getEmbeddingProvenance").mockReturnValueOnce(null);
    const row = embeddingLifecycle.registerEmbeddingProvenance(database, {
      canonicalId,
      storeId: "vector",
      sourceHash: "a".repeat(64),
      modelId: "m-fallback",
      provenance: "batch20",
      metadata: { lane: "batch20" },
    });
    expect(row.canonicalId).toBe(canonicalId);
    expect(row.lifecycleState).toBe("active");
    expect(row.metadata.lane).toBe("batch20");
  });

  it("markEmbeddingStale returns null when provenance table is absent", () => {
    const database = freshDb();
    database.exec("DROP TABLE memory_embedding_provenance");
    expect(
      embeddingLifecycle.markEmbeddingStale(database, {
        tenantId: "default-tenant",
        id: "missing",
        reason: "ignored",
      }),
    ).toBeNull();
  });

  it("markEmbeddingDegraded returns null when provenance table is absent", () => {
    const database = freshDb();
    database.exec("DROP TABLE memory_embedding_provenance");
    expect(
      embeddingLifecycle.markEmbeddingDegraded(database, {
        tenantId: "default-tenant",
        id: "missing",
        reason: "ignored",
      }),
    ).toBeNull();
  });

  it("removeEmbeddingForCanonical fails closed when provenance table is missing", () => {
    const database = freshDb();
    database.exec("DROP TABLE memory_embedding_provenance");
    const result = embeddingLifecycle.removeEmbeddingForCanonical(database, {
      tenantId: "default-tenant",
      row: {
        id: "emb-x",
        tenantId: "default-tenant",
        canonicalId: "canon-x",
        storeId: "vector",
        adapterKind: "local",
        sourceHash: "b".repeat(64),
        modelId: "m",
        modelVersion: null,
        dimensionality: 0,
        provenance: "test",
        lifecycleState: "active",
        removability: "erasable",
        externalRef: null,
        lastRefreshedAt: null,
        metadata: {},
        erasureId: null,
        removedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      erasureId: `er-${crypto.randomUUID()}`,
    });
    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/table missing/);
  });

  it("LocalMessageEmbeddingAdapter returns false when message_embeddings table is absent", () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS message_embeddings");
    const row = embeddingLifecycle.registerEmbeddingProvenance(database, {
      canonicalId: `canon-no-emb-${crypto.randomUUID().slice(0, 6)}`,
      storeId: "vector",
      sourceHash: "c".repeat(64),
      modelId: "m-no-table",
      provenance: "batch20",
    });
    const adapter = new embeddingLifecycle.LocalMessageEmbeddingAdapter(database, "vector");
    expect(adapter.delete("default-tenant", row)).toBe(false);
  });
});
