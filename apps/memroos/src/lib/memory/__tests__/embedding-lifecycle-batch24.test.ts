// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
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
  vi.restoreAllMocks();
});

describe("embedding-lifecycle batch24 — upsert branches and removal outcomes", () => {
  it("re-register preserves removed lifecycle_state on conflict upsert", () => {
    const database = freshDb();
    const canonicalId = `tomb-preserve-${randomUUID().slice(0, 8)}`;
    const first = registerEmbeddingProvenance(database, {
      canonicalId,
      storeId: "vector",
      sourceHash: "a".repeat(64),
      modelId: "m-b24",
      provenance: "batch24",
    });
    database
      .prepare(`UPDATE memory_embedding_provenance SET lifecycle_state = 'removed' WHERE id = ?`)
      .run(first.id);
    const second = registerEmbeddingProvenance(database, {
      canonicalId,
      storeId: "vector",
      sourceHash: "b".repeat(64),
      modelId: "m-b24",
      provenance: "batch24-reregister",
      modelVersion: "v2",
    });
    expect(second.lifecycleState).toBe("removed");
    expect(second.modelVersion).toBe("v2");
  });

  it("registerEmbeddingProvenance throws when provenance table is missing", () => {
    const database = freshDb();
    database.exec("DROP TABLE memory_embedding_provenance");
    expect(() =>
      registerEmbeddingProvenance(database, {
        canonicalId: `missing-table-${randomUUID().slice(0, 6)}`,
        storeId: "vector",
        sourceHash: "c".repeat(64),
        modelId: "m-missing",
        provenance: "batch24",
      }),
    ).toThrow(/memory_embedding_provenance table is missing/);
  });

  it("removeEmbeddingForCanonical without adapter marks row removed (purged status)", () => {
    const database = freshDb();
    const row = registerEmbeddingProvenance(database, {
      canonicalId: `no-adapter-${randomUUID().slice(0, 6)}`,
      storeId: "vector",
      sourceHash: "d".repeat(64),
      modelId: "m-no-adapter",
      provenance: "batch24",
      removability: "erasable",
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
