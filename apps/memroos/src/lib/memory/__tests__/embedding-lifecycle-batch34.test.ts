// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import * as embeddingLifecycle from "../embedding-lifecycle";
import {
  LocalMessageEmbeddingAdapter,
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
  vi.restoreAllMocks();
  db?.close();
  db = null;
});

describe("embedding-lifecycle batch34 — synthesized row, tombstone, adapter guards", () => {
  it("registerEmbeddingProvenance synthesizes row when reread is null (200)", () => {
    const database = freshDb();
    vi.spyOn(embeddingLifecycle, "getEmbeddingProvenance").mockReturnValue(null);
    const canonicalId = `synth-b34-${randomUUID().slice(0, 8)}`;
    const row = registerEmbeddingProvenance(database, {
      canonicalId,
      storeId: "vector",
      sourceHash: "d".repeat(64),
      modelId: "m-synth-b34",
      provenance: "batch34",
      metadata: { lane: "batch34" },
    });
    expect(row.canonicalId).toBe(canonicalId);
    expect(row.metadata.lane).toBe("batch34");
  });

  it("removeEmbeddingForCanonical maps adapter throw to unavailable (410)", () => {
    const database = freshDb();
    const row = registerEmbeddingProvenance(database, {
      canonicalId: `rm-b34-${randomUUID().slice(0, 8)}`,
      storeId: "vector",
      sourceHash: "b".repeat(64),
      modelId: "m-rm-b34",
      provenance: "batch34",
    });
    const unavailable = removeEmbeddingForCanonical(database, {
      tenantId: row.tenantId,
      row,
      erasureId: `er-${randomUUID()}`,
      adapter: {
        storeId: "vector",
        delete: () => {
          throw new Error("adapter_down_b34");
        },
      },
    });
    expect(unavailable.status).toBe("unavailable");
    expect(unavailable.reason).toBe("adapter_down_b34");
  });

  it("removeEmbeddingForCanonical reports zero_match when adapter delete returns false (411)", () => {
    const database = freshDb();
    const row = registerEmbeddingProvenance(database, {
      canonicalId: `tomb-b34-${randomUUID().slice(0, 8)}`,
      storeId: "vector",
      sourceHash: "c".repeat(64),
      modelId: "m-tomb-b34",
      provenance: "batch34",
    });
    const result = removeEmbeddingForCanonical(database, {
      tenantId: row.tenantId,
      row,
      erasureId: `er-${randomUUID()}`,
      adapter: { storeId: "vector", delete: () => false },
    });
    expect(result.status).toBe("zero_match");
    expect(result.reason).toBe("adapter_zero_match");
  });

  it("LocalMessageEmbeddingAdapter returns false when message_embeddings table missing (436)", () => {
    const bare = new Database(":memory:");
    const adapter = new LocalMessageEmbeddingAdapter(bare, "vector");
    expect(
      adapter.delete("default-tenant", {
        id: "emb-x",
        tenantId: "default-tenant",
        canonicalId: "c",
        storeId: "vector",
        adapterKind: "local",
        sourceHash: "a",
        modelId: "m",
        modelVersion: null,
        dimensionality: 0,
        provenance: "t",
        lifecycleState: "active",
        removability: "erasable",
        externalRef: null,
        lastRefreshedAt: null,
        metadata: {},
        erasureId: null,
        removedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    ).toBe(false);
    bare.close();
  });
});
