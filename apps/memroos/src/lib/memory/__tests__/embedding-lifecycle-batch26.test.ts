// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import * as embeddingLifecycle from "../embedding-lifecycle";
import { LocalMessageEmbeddingAdapter, registerEmbeddingProvenance, removeEmbeddingForCanonical } from "../embedding-lifecycle";

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

describe("embedding-lifecycle batch26 — reread fallback and adapter zero_match", () => {
  it("registerEmbeddingProvenance synthesizes row when post-insert lookup misses", () => {
    const database = freshDb();
    vi.spyOn(embeddingLifecycle, "getEmbeddingProvenance").mockReturnValue(null);
    const canonicalId = `synth-${randomUUID().slice(0, 8)}`;
    const row = registerEmbeddingProvenance(database, {
      canonicalId,
      storeId: "vector",
      sourceHash: "e".repeat(64),
      modelId: "m-synth-b26",
      provenance: "batch26",
      modelVersion: "v-test",
      dimensionality: 4,
    });
    expect(row.canonicalId).toBe(canonicalId);
    expect(row.modelVersion).toBe("v-test");
    expect(row.lifecycleState).toBe("active");
  });

  it("removeEmbeddingForCanonical maps adapter zero_match to zero_match status", () => {
    const database = freshDb();
    const row = registerEmbeddingProvenance(database, {
      canonicalId: `zero-${randomUUID().slice(0, 8)}`,
      storeId: "vector",
      sourceHash: "f".repeat(64),
      modelId: "m-zero-b26",
      provenance: "batch26",
      metadata: { message_id: 999999 },
    });
    const adapter = new LocalMessageEmbeddingAdapter(database, "vector");
    const result = removeEmbeddingForCanonical(database, {
      tenantId: row.tenantId,
      row,
      erasureId: `er-${randomUUID()}`,
      adapter,
    });
    expect(result.status).toBe("zero_match");
    expect(result.reason).toBe("adapter_zero_match");
    expect(result.row.lifecycleState).toBe("tombstoned");
  });

  it("LocalMessageEmbeddingAdapter returns false when message_embeddings table is missing", () => {
    const database = freshDb();
    database.exec("DROP TABLE message_embeddings");
    const row = registerEmbeddingProvenance(database, {
      canonicalId: `no-table-${randomUUID().slice(0, 8)}`,
      storeId: "vector",
      sourceHash: "g".repeat(64),
      modelId: "m-no-table",
      provenance: "batch26",
      metadata: { message_id: 1 },
    });
    const adapter = new LocalMessageEmbeddingAdapter(database, "vector");
    expect(adapter.delete(row.tenantId, row)).toBe(false);
  });
});
