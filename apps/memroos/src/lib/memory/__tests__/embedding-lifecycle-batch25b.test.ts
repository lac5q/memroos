// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { listEmbeddingProvenanceForCanonical, markEmbeddingStale, registerEmbeddingProvenance } from "../embedding-lifecycle";

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

describe("embedding-lifecycle batch25b — listing and model metadata", () => {
  it("listEmbeddingProvenanceForCanonical returns rows for one canonical id", () => {
    const database = freshDb();
    const canonicalA = `canon-a-${randomUUID().slice(0, 6)}`;
    const canonicalB = `canon-b-${randomUUID().slice(0, 6)}`;
    const rowA = registerEmbeddingProvenance(database, {
      canonicalId: canonicalA,
      storeId: "vector",
      sourceHash: "a".repeat(64),
      modelId: "m-b25b",
      provenance: "batch25b",
      modelVersion: "v1",
    });
    registerEmbeddingProvenance(database, {
      canonicalId: canonicalB,
      storeId: "vector",
      sourceHash: "b".repeat(64),
      modelId: "m-b25b",
      provenance: "batch25b",
    });
    const listed = listEmbeddingProvenanceForCanonical(database, rowA.tenantId, canonicalA);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.canonicalId).toBe(canonicalA);
    expect(listed[0]?.modelVersion).toBe("v1");
  });

  it("markEmbeddingStale updates lifecycle_state for active rows", () => {
    const database = freshDb();
    const row = registerEmbeddingProvenance(database, {
      canonicalId: `stale-${randomUUID().slice(0, 6)}`,
      storeId: "vector",
      sourceHash: "c".repeat(64),
      modelId: "m-stale",
      provenance: "batch25b",
    });
    const stale = markEmbeddingStale(database, {
      tenantId: row.tenantId,
      id: row.id,
      reason: "refresh batch25b",
    });
    expect(stale?.lifecycleState).toBe("stale");
  });
});
