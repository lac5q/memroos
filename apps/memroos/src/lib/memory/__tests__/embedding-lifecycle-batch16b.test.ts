// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
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

describe("embedding-lifecycle batch16b — provenance lifecycle edges", () => {
  it("registerEmbeddingProvenance upserts on duplicate key", () => {
    const database = freshDb();
    const canonicalId = `canon-${crypto.randomUUID().slice(0, 8)}`;
    const first = registerEmbeddingProvenance(database, {
      tenantId: "default-tenant",
      canonicalId,
      storeId: "vector",
      sourceHash: "a".repeat(64),
      modelId: "text-embedding-test",
      provenance: "batch16b",
    });
    const second = registerEmbeddingProvenance(database, {
      tenantId: "default-tenant",
      canonicalId,
      storeId: "vector",
      sourceHash: "b".repeat(64),
      modelId: "text-embedding-test",
      provenance: "batch16b-refresh",
      now: new Date("2026-07-02T00:00:00.000Z"),
    });
    expect(second.id).toBe(first.id);
    expect(second.sourceHash).toBe("b".repeat(64));
    expect(listEmbeddingProvenanceForCanonical(database, "default-tenant", canonicalId)).toHaveLength(1);
  });

  it("markEmbeddingStale and markEmbeddingDegraded annotate metadata", () => {
    const database = freshDb();
    const row = registerEmbeddingProvenance(database, {
      canonicalId: `canon-stale-${crypto.randomUUID().slice(0, 6)}`,
      storeId: "fts",
      sourceHash: "c".repeat(64),
      modelId: "m-stale",
      provenance: "test",
    });
    const stale = markEmbeddingStale(database, {
      tenantId: "default-tenant",
      id: row.id,
      reason: "provider_lag",
      now: new Date("2026-07-03T00:00:00.000Z"),
    });
    expect(stale?.lifecycleState).toBe("stale");

    const fresh = registerEmbeddingProvenance(database, {
      canonicalId: `canon-deg-${crypto.randomUUID().slice(0, 6)}`,
      storeId: "fts",
      sourceHash: "d".repeat(64),
      modelId: "m-deg",
      provenance: "test",
    });
    const degraded = markEmbeddingDegraded(database, {
      tenantId: "default-tenant",
      id: fresh.id,
      reason: "partial_index",
    });
    expect(degraded?.lifecycleState).toBe("degraded");
  });

  it("removeEmbeddingForCanonical skips retained removability", () => {
    const database = freshDb();
    const row = registerEmbeddingProvenance(database, {
      canonicalId: `canon-ret-${crypto.randomUUID().slice(0, 6)}`,
      storeId: "vector",
      sourceHash: "e".repeat(64),
      modelId: "m-ret",
      provenance: "test",
      removability: "retained",
    });
    const outcome = removeEmbeddingForCanonical(database, {
      tenantId: "default-tenant",
      row,
      erasureId: `er-${crypto.randomUUID()}`,
    });
    expect(outcome.status).toBe("skipped_retained");
  });

  it("markEmbeddingStale returns null for missing rows", () => {
    const database = freshDb();
    expect(
      markEmbeddingStale(database, {
        tenantId: "default-tenant",
        id: "missing-row",
        reason: "n/a",
      }),
    ).toBeNull();
  });
});
