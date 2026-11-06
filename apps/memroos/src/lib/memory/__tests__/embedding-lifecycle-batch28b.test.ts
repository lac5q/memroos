// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
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

describe("embedding-lifecycle batch28b — upsert, stale/degraded, retained skip", () => {
  it("registerEmbeddingProvenance upserts the same dedupe key without duplicating rows", () => {
    const database = freshDb();
    const canonicalId = `upsert-b28b-${randomUUID().slice(0, 8)}`;
    const first = registerEmbeddingProvenance(database, {
      canonicalId,
      storeId: "vector",
      sourceHash: "d".repeat(64),
      modelId: "m-upsert-b28b",
      provenance: "batch28b",
      modelVersion: "v1",
    });
    const second = registerEmbeddingProvenance(database, {
      canonicalId,
      storeId: "vector",
      sourceHash: "e".repeat(64),
      modelId: "m-upsert-b28b",
      provenance: "batch28b-refresh",
      modelVersion: "v2",
    });
    expect(second.id).toBe(first.id);
    expect(second.modelVersion).toBe("v2");
    expect(listEmbeddingProvenanceForCanonical(database, "default-tenant", canonicalId)).toHaveLength(1);
  });

  it("markEmbeddingStale records stale_reason metadata", () => {
    const database = freshDb();
    const row = registerEmbeddingProvenance(database, {
      canonicalId: `stale-b28b-${randomUUID().slice(0, 8)}`,
      storeId: "vector",
      sourceHash: "f".repeat(64),
      modelId: "m-stale-b28b",
      provenance: "batch28b",
    });
    const updated = markEmbeddingStale(database, {
      tenantId: row.tenantId,
      id: row.id,
      reason: "model-rotated-b28b",
    });
    expect(updated?.lifecycleState).toBe("stale");
    expect(updated?.metadata.stale_reason).toBe("model-rotated-b28b");
  });

  it("markEmbeddingDegraded is a no-op state change for removed rows", () => {
    const database = freshDb();
    const row = registerEmbeddingProvenance(database, {
      canonicalId: `removed-b28b-${randomUUID().slice(0, 8)}`,
      storeId: "vector",
      sourceHash: "g".repeat(64),
      modelId: "m-removed-b28b",
      provenance: "batch28b",
    });
    removeEmbeddingForCanonical(database, {
      tenantId: row.tenantId,
      row,
      erasureId: `er-${randomUUID()}`,
    });
    const existing = getEmbeddingProvenance(
      database,
      row.tenantId,
      row.canonicalId,
      row.storeId,
      row.modelId,
      row.adapterKind,
    );
    const degraded = markEmbeddingDegraded(database, {
      tenantId: row.tenantId,
      id: row.id,
      reason: "should-not-apply-b28b",
    });
    expect(degraded?.lifecycleState).toBe("removed");
    expect(existing?.lifecycleState).toBe("removed");
  });

  it("removeEmbeddingForCanonical skips retained removability", () => {
    const database = freshDb();
    const row = registerEmbeddingProvenance(database, {
      canonicalId: `retained-b28b-${randomUUID().slice(0, 8)}`,
      storeId: "vector",
      sourceHash: "h".repeat(64),
      modelId: "m-retained-b28b",
      provenance: "batch28b",
      removability: "retained",
    });
    const result = removeEmbeddingForCanonical(database, {
      tenantId: row.tenantId,
      row,
      erasureId: `er-${randomUUID()}`,
      adapter: { storeId: "vector", delete: () => true },
    });
    expect(result.status).toBe("skipped_retained");
  });
});
