// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  db?.close();
  db = null;
});

describe("embedding-lifecycle batch35b", () => {
  it("registerEmbeddingProvenance synthesizes row when getEmbeddingProvenance returns null after insert (200)", async () => {
    const database = freshDb();
    const lifecycle = await import("../embedding-lifecycle");
    vi.spyOn(lifecycle, "getEmbeddingProvenance").mockReturnValueOnce(null);
    const canonicalId = `synth-b35b-${randomUUID().slice(0, 8)}`;
    const row = lifecycle.registerEmbeddingProvenance(database, {
      canonicalId,
      storeId: "vector",
      sourceHash: "a".repeat(64),
      modelId: "m-synth-b35b",
      provenance: "batch35b",
      externalRef: "ext-b35b",
    });
    expect(row.canonicalId).toBe(canonicalId);
    expect(row.externalRef).toBe("ext-b35b");
    expect(row.lifecycleState).toBe("active");
  });
});
