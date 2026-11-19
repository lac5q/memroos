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

describe("embedding-lifecycle batch23 — degraded guard, adapter outcomes, row defaults", () => {
  it("registerEmbeddingProvenance synthesizes fallback row when post-insert lookup misses", () => {
    const database = freshDb();
    const canonicalId = `canon-b23-${crypto.randomUUID().slice(0, 8)}`;
    vi.spyOn(embeddingLifecycle, "getEmbeddingProvenance").mockReturnValueOnce(null);
    const row = embeddingLifecycle.registerEmbeddingProvenance(database, {
      canonicalId,
      storeId: "vector",
      sourceHash: "a".repeat(64),
      modelId: "m-b23",
      provenance: "batch23",
      removability: "deferred",
      externalRef: "ext-b23",
    });
    expect(row.canonicalId).toBe(canonicalId);
    expect(row.removability).toBe("deferred");
    expect(row.externalRef).toBe("ext-b23");
  });

  it("markEmbeddingDegraded is a no-op for removed provenance rows", () => {
    const database = freshDb();
    const row = embeddingLifecycle.registerEmbeddingProvenance(database, {
      canonicalId: `removed-b23-${crypto.randomUUID().slice(0, 6)}`,
      storeId: "vector",
      sourceHash: "b".repeat(64),
      modelId: "m-removed",
      provenance: "batch23",
    });
    database
      .prepare(`UPDATE memory_embedding_provenance SET lifecycle_state = 'removed' WHERE id = ?`)
      .run(row.id);
    const degraded = embeddingLifecycle.markEmbeddingDegraded(database, {
      tenantId: row.tenantId,
      id: row.id,
      reason: "ignored",
    });
    expect(degraded?.lifecycleState).toBe("removed");
  });

  it("markEmbeddingDegraded returns null when row disappears after update", () => {
    const database = freshDb();
    const row = embeddingLifecycle.registerEmbeddingProvenance(database, {
      canonicalId: `ghost-b23-${crypto.randomUUID().slice(0, 6)}`,
      storeId: "vector",
      sourceHash: "c".repeat(64),
      modelId: "m-ghost",
      provenance: "batch23",
    });
    const originalPrepare = database.prepare.bind(database);
    vi.spyOn(database, "prepare").mockImplementation((sql: string) => {
      const stmt = originalPrepare(sql);
      if (sql.includes("SELECT * FROM memory_embedding_provenance") && sql.includes("AND id = ?")) {
        const originalGet = stmt.get.bind(stmt);
        stmt.get = (...args: unknown[]) => {
          database.prepare(`DELETE FROM memory_embedding_provenance WHERE id = ?`).run(row.id);
          return originalGet(...args);
        };
      }
      return stmt;
    });
    expect(
      embeddingLifecycle.markEmbeddingDegraded(database, {
        tenantId: row.tenantId,
        id: row.id,
        reason: "race",
      }),
    ).toBeNull();
  });

  it("removeEmbeddingForCanonical maps adapter failures to unavailable and zero_match", () => {
    const database = freshDb();
    const base = embeddingLifecycle.registerEmbeddingProvenance(database, {
      canonicalId: `erase-b23-${crypto.randomUUID().slice(0, 6)}`,
      storeId: "vector",
      sourceHash: "d".repeat(64),
      modelId: "m-erase",
      provenance: "batch23",
    });
    const throwingAdapter: embeddingLifecycle.EmbeddingLifecycleAdapter = {
      storeId: "vector",
      delete: () => {
        throw new Error("adapter_down");
      },
    };
    const unavailable = embeddingLifecycle.removeEmbeddingForCanonical(database, {
      tenantId: base.tenantId,
      row: base,
      erasureId: `er-${crypto.randomUUID()}`,
      adapter: throwingAdapter,
    });
    expect(unavailable.status).toBe("unavailable");
    expect(unavailable.reason).toBe("adapter_down");

    const fresh = embeddingLifecycle.registerEmbeddingProvenance(database, {
      canonicalId: `zero-b23-${crypto.randomUUID().slice(0, 6)}`,
      storeId: "vector",
      sourceHash: "e".repeat(64),
      modelId: "m-zero",
      provenance: "batch23",
    });
    const zeroAdapter: embeddingLifecycle.EmbeddingLifecycleAdapter = {
      storeId: "vector",
      delete: () => false,
    };
    const zeroMatch = embeddingLifecycle.removeEmbeddingForCanonical(database, {
      tenantId: fresh.tenantId,
      row: fresh,
      erasureId: `er-${crypto.randomUUID()}`,
      adapter: zeroAdapter,
    });
    expect(zeroMatch.status).toBe("zero_match");
  });

  it("listEmbeddingProvenance coerces nullable DB columns via rowToProvenance", () => {
    const database = freshDb();
    const row = embeddingLifecycle.registerEmbeddingProvenance(database, {
      canonicalId: `canon-null-${crypto.randomUUID().slice(0, 6)}`,
      storeId: "vector",
      sourceHash: "f".repeat(64),
      modelId: "m-null",
      provenance: "batch23",
    });
    database
      .prepare(`UPDATE memory_embedding_provenance SET metadata_json = 'not-json' WHERE id = ?`)
      .run(row.id);
    const rows = embeddingLifecycle.listEmbeddingProvenanceForCanonical(database, row.tenantId, row.canonicalId);
    expect(rows[0]?.metadata).toEqual({});
  });
});
