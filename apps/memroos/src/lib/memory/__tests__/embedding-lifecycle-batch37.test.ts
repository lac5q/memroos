// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import * as embeddingLifecycle from "../embedding-lifecycle";
import {
  getEmbeddingProvenance,
  registerEmbeddingProvenance,
  removeEmbeddingForCanonical,
  type EmbeddingLifecycleAdapter,
} from "../embedding-lifecycle";

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

describe("embedding-lifecycle batch37 — tombstone upsert, metadata parse", () => {
  it("registerEmbeddingProvenance keeps removed lifecycle on conflict (173-176)", () => {
    const database = freshDb();
    const canonicalId = `tomb-b37-${randomUUID().slice(0, 8)}`;
    const row = registerEmbeddingProvenance(database, {
      canonicalId,
      storeId: "vector",
      sourceHash: "d".repeat(64),
      modelId: "m-tomb-b37",
      provenance: "batch37",
    });
    removeEmbeddingForCanonical(database, {
      tenantId: row.tenantId,
      row,
      erasureId: `er-b37-${randomUUID()}`,
    });
    const refreshed = registerEmbeddingProvenance(database, {
      canonicalId,
      storeId: "vector",
      sourceHash: "e".repeat(64),
      modelId: "m-tomb-b37",
      provenance: "batch37-reregister",
    });
    expect(refreshed.lifecycleState).toBe("removed");
    expect(refreshed.sourceHash).toBe("e".repeat(64));
  });

  it("getEmbeddingProvenance tolerates invalid metadata_json (110-125)", () => {
    const database = freshDb();
    const canonicalId = `meta-b37-${randomUUID().slice(0, 8)}`;
    registerEmbeddingProvenance(database, {
      canonicalId,
      storeId: "vector",
      sourceHash: "f".repeat(64),
      modelId: "m-meta-b37",
      provenance: "batch37",
      metadata: { batch: "37" },
    });
    database
      .prepare(
        `UPDATE memory_embedding_provenance
         SET metadata_json = ?
         WHERE canonical_id = ?`,
      )
      .run("not-json-b37", canonicalId);
    const row = getEmbeddingProvenance(database, "default-tenant", canonicalId, "vector", "m-meta-b37", "local");
    expect(row?.metadata).toEqual({});
  });

  it("registerEmbeddingProvenance synthesizes row when post-insert reread misses (200)", () => {
    const database = freshDb();
    vi.spyOn(embeddingLifecycle, "getEmbeddingProvenance").mockReturnValueOnce(null);
    const canonicalId = `synth-b37-${randomUUID().slice(0, 8)}`;
    const row = registerEmbeddingProvenance(database, {
      canonicalId,
      storeId: "vector",
      sourceHash: "b".repeat(64),
      modelId: "m-synth-b37",
      provenance: "batch37",
    });
    expect(row.canonicalId).toBe(canonicalId);
    expect(row.lifecycleState).toBe("active");
  });

  it("removeEmbeddingForCanonical maps adapter throw to unavailable (409)", () => {
    const database = freshDb();
    const row = registerEmbeddingProvenance(database, {
      canonicalId: `unavail-b37-${randomUUID().slice(0, 8)}`,
      storeId: "vector",
      sourceHash: "c".repeat(64),
      modelId: "m-unavail-b37",
      provenance: "batch37",
    });
    const adapter: EmbeddingLifecycleAdapter = {
      storeId: "vector",
      delete: () => {
        throw new Error("store offline b37");
      },
    };
    const result = removeEmbeddingForCanonical(database, {
      tenantId: row.tenantId,
      row,
      erasureId: `er-b37-${randomUUID()}`,
      adapter,
    });
    expect(result.status).toBe("unavailable");
  });

  it.skip("removeEmbeddingForCanonical failed status branch (410/413) — adapterOutcome never literal failed at runtime", () => {});
});