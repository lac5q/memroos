// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import * as embeddingLifecycle from "../embedding-lifecycle";
import { registerEmbeddingProvenance, removeEmbeddingForCanonical } from "../embedding-lifecycle";

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

describe("embedding-lifecycle batch31 — reread fallback and remove branches", () => {
  it("registerEmbeddingProvenance synthesizes row when reread misses (line 200)", () => {
    const database = freshDb();
    vi.spyOn(embeddingLifecycle, "getEmbeddingProvenance").mockReturnValue(null);
    const canonicalId = `synth-b31-${randomUUID().slice(0, 8)}`;
    const row = registerEmbeddingProvenance(database, {
      canonicalId,
      storeId: "vector",
      sourceHash: "a".repeat(64),
      modelId: "m-synth-b31",
      provenance: "batch31",
      externalRef: "ext-b31",
      modelVersion: "2.0",
      dimensionality: 384,
    });
    expect(row.canonicalId).toBe(canonicalId);
    expect(row.modelVersion).toBe("2.0");
    expect(row.dimensionality).toBe(384);
  });

  it("removeEmbeddingForCanonical maps adapter throw to unavailable (lines 380-410)", () => {
    const database = freshDb();
    const row = registerEmbeddingProvenance(database, {
      canonicalId: `unavail-b31-${randomUUID().slice(0, 8)}`,
      storeId: "vector",
      sourceHash: "b".repeat(64),
      modelId: "m-unavail-b31",
      provenance: "batch31",
    });
    const result = removeEmbeddingForCanonical(database, {
      tenantId: row.tenantId,
      row,
      erasureId: `er-${randomUUID()}`,
      adapter: {
        storeId: "vector",
        delete: () => {
          throw new Error("adapter_down_b31");
        },
      },
    });
    expect(result.status).toBe("unavailable");
    expect(result.reason).toBe("adapter_down_b31");
    expect(result.row.lifecycleState).toBe("tombstoned");
  });

  it("removeEmbeddingForCanonical tombstones when adapter returns zero_match (lines 410-413)", () => {
    const database = freshDb();
    const row = registerEmbeddingProvenance(database, {
      canonicalId: `tomb-b31-${randomUUID().slice(0, 8)}`,
      storeId: "embeddings",
      sourceHash: "c".repeat(64),
      modelId: "m-tomb-b31",
      provenance: "batch31",
    });
    const result = removeEmbeddingForCanonical(database, {
      tenantId: row.tenantId,
      row,
      erasureId: `er-${randomUUID()}`,
      adapter: { storeId: "embeddings", delete: () => false },
    });
    expect(result.status).toBe("zero_match");
    expect(result.row.lifecycleState).toBe("tombstoned");
  });
});
