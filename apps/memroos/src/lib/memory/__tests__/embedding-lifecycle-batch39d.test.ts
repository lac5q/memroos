// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import * as embeddingLifecycle from "../embedding-lifecycle";
import { registerEmbeddingProvenance } from "../embedding-lifecycle";

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

describe("embedding-lifecycle batch39d", () => {
  it.skip("removeEmbeddingForCanonical tombstone else (410-413) — unreachable after adapter guards", () => {});

  it("registerEmbeddingProvenance synthesizes row when post-insert reread misses (200)", () => {
    const database = freshDb();
    vi.spyOn(embeddingLifecycle, "getEmbeddingProvenance").mockReturnValue(null);
    const canonicalId = `synth-b39d-${randomUUID().slice(0, 8)}`;
    const row = registerEmbeddingProvenance(database, {
      canonicalId,
      storeId: "vector",
      sourceHash: "f".repeat(64),
      modelId: "m-synth-b39d",
      provenance: "batch39d",
      modelVersion: "4.0",
      dimensionality: 384,
    });
    expect(row.canonicalId).toBe(canonicalId);
    expect(row.lifecycleState).toBe("active");
  });
});