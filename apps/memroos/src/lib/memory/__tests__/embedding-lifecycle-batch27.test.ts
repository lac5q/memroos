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

describe("embedding-lifecycle batch27 — reread fallback and remove status mapping", () => {
  it("registerEmbeddingProvenance synthesizes row when immediate reread misses", () => {
    const database = freshDb();
    vi.spyOn(embeddingLifecycle, "getEmbeddingProvenance").mockReturnValue(null);
    const canonicalId = `synth-b27-${randomUUID().slice(0, 8)}`;
    const row = registerEmbeddingProvenance(database, {
      canonicalId,
      storeId: "vector",
      sourceHash: "a".repeat(64),
      modelId: "m-synth-b27",
      provenance: "batch27",
      modelVersion: "v-b27",
      dimensionality: 8,
    });
    expect(row.canonicalId).toBe(canonicalId);
    expect(row.lifecycleState).toBe("active");
    expect(row.modelVersion).toBe("v-b27");
  });

  it("removeEmbeddingForCanonical maps adapter errors to unavailable", () => {
    const database = freshDb();
    const row = registerEmbeddingProvenance(database, {
      canonicalId: `err-b27-${randomUUID().slice(0, 8)}`,
      storeId: "vector",
      sourceHash: "b".repeat(64),
      modelId: "m-err-b27",
      provenance: "batch27",
    });
    const adapter = {
      storeId: "vector",
      delete: () => {
        throw new Error("adapter-unavailable-b27");
      },
    };
    const result = removeEmbeddingForCanonical(database, {
      tenantId: row.tenantId,
      row,
      erasureId: `er-${randomUUID()}`,
      adapter,
    });
    expect(result.status).toBe("unavailable");
    expect(result.reason).toMatch(/adapter-unavailable-b27/);
  });

  it("removeEmbeddingForCanonical without adapter marks row purged", () => {
    const database = freshDb();
    const row = registerEmbeddingProvenance(database, {
      canonicalId: `purge-b27-${randomUUID().slice(0, 8)}`,
      storeId: "vector",
      sourceHash: "c".repeat(64),
      modelId: "m-purge-b27",
      provenance: "batch27",
    });
    const result = removeEmbeddingForCanonical(database, {
      tenantId: row.tenantId,
      row,
      erasureId: `er-${randomUUID()}`,
    });
    expect(result.status).toBe("purged");
    expect(result.row.lifecycleState).toBe("removed");
  });
});
