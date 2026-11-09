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

describe("embedding-lifecycle batch32 — synthesized row and purged adapter path", () => {
  // sticky: removeEmbeddingForCanonical final else tombstoned branch (413) is unreachable after outcome guards.

  it("registerEmbeddingProvenance synthesizes row when post-insert reread misses (line 200)", () => {
    const database = freshDb();
    vi.spyOn(embeddingLifecycle, "getEmbeddingProvenance").mockReturnValue(null);
    const canonicalId = `synth-b32-${randomUUID().slice(0, 8)}`;
    const row = registerEmbeddingProvenance(database, {
      canonicalId,
      storeId: "vector",
      sourceHash: "d".repeat(64),
      modelId: "m-synth-b32",
      provenance: "batch32",
      modelVersion: "3.1",
      dimensionality: 512,
    });
    expect(row.canonicalId).toBe(canonicalId);
    expect(row.modelVersion).toBe("3.1");
    expect(row.lifecycleState).toBe("active");
  });

  it("removeEmbeddingForCanonical reports purged when adapter delete succeeds (lines 412-413)", () => {
    const database = freshDb();
    const row = registerEmbeddingProvenance(database, {
      canonicalId: `purge-b32-${randomUUID().slice(0, 8)}`,
      storeId: "vector",
      sourceHash: "e".repeat(64),
      modelId: "m-purge-b32",
      provenance: "batch32",
    });
    const result = removeEmbeddingForCanonical(database, {
      tenantId: row.tenantId,
      row,
      erasureId: `er-${randomUUID()}`,
      adapter: { storeId: "vector", delete: () => true },
    });
    expect(result.status).toBe("purged");
    expect(result.row.lifecycleState).toBe("removed");
  });
});
