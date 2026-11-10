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

describe("embedding-lifecycle batch30b — reread fallback and remove status branches", () => {
  it("registerEmbeddingProvenance falls back when post-upsert reread misses (line 200)", () => {
    const database = freshDb();
    vi.spyOn(embeddingLifecycle, "getEmbeddingProvenance").mockReturnValue(null);
    const canonicalId = `synth-b30b-${randomUUID().slice(0, 8)}`;
    const row = registerEmbeddingProvenance(database, {
      canonicalId,
      storeId: "vector",
      sourceHash: "d".repeat(64),
      modelId: "m-synth-b30b",
      provenance: "batch30b",
      externalRef: "ext-b30b",
    });
    expect(row.canonicalId).toBe(canonicalId);
    expect(row.lifecycleState).toBe("active");
    expect(row.externalRef).toBe("ext-b30b");
  });

  it("removeEmbeddingForCanonical maps zero_match and tombstone paths (lines 410–413)", () => {
    const database = freshDb();
    const row = registerEmbeddingProvenance(database, {
      canonicalId: `zm-b30b-${randomUUID().slice(0, 8)}`,
      storeId: "vector",
      sourceHash: "e".repeat(64),
      modelId: "m-zm-b30b",
      provenance: "batch30b",
    });
    const zeroMatch = removeEmbeddingForCanonical(database, {
      tenantId: row.tenantId,
      row,
      erasureId: `er-${randomUUID()}`,
      adapter: { storeId: "vector", delete: () => false },
    });
    expect(zeroMatch.status).toBe("zero_match");
    expect(zeroMatch.row.lifecycleState).toBe("tombstoned");

    const row2 = registerEmbeddingProvenance(database, {
      canonicalId: `purge-b30b-${randomUUID().slice(0, 8)}`,
      storeId: "vector",
      sourceHash: "f".repeat(64),
      modelId: "m-purge-b30b",
      provenance: "batch30b",
    });
    const purged = removeEmbeddingForCanonical(database, {
      tenantId: row2.tenantId,
      row: row2,
      erasureId: `er-${randomUUID()}`,
    });
    expect(purged.status).toBe("purged");
  });

  // unreachable: adapterOutcome is never assigned the literal "failed" (only purged | zero_match | unavailable).
});
