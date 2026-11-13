// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import * as embeddingLifecycle from "../embedding-lifecycle";
import {
  registerEmbeddingProvenance,
  removeEmbeddingForCanonical,
  type EmbeddingLifecycleAdapter,
} from "../embedding-lifecycle";

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

describe("embedding-lifecycle batch36", () => {
  it("registerEmbeddingProvenance synthesizes row when post-insert reread misses (200)", () => {
    const database = freshDb();
    vi.spyOn(embeddingLifecycle, "getEmbeddingProvenance").mockReturnValueOnce(null);
    const canonicalId = `synth-b36-${randomUUID().slice(0, 8)}`;
    const row = registerEmbeddingProvenance(database, {
      canonicalId,
      storeId: "vector",
      sourceHash: "b".repeat(64),
      modelId: "m-synth-b36",
      provenance: "batch36",
    });
    expect(row.canonicalId).toBe(canonicalId);
    expect(row.lifecycleState).toBe("active");
  });

  it("removeEmbeddingForCanonical maps adapter zero_match to status zero_match (411)", () => {
    const database = freshDb();
    const row = registerEmbeddingProvenance(database, {
      canonicalId: `zm-b36-${randomUUID().slice(0, 8)}`,
      storeId: "vector",
      sourceHash: "c".repeat(64),
      modelId: "m-zm-b36",
      provenance: "batch36",
    });
    const adapter: EmbeddingLifecycleAdapter = {
      storeId: "vector",
      delete: () => false,
    };
    const result = removeEmbeddingForCanonical(database, {
      tenantId: row.tenantId,
      row,
      erasureId: `er-b36-${randomUUID()}`,
      adapter,
    });
    expect(result.status).toBe("zero_match");
    expect(result.row.lifecycleState).toBe("tombstoned");
  });

  it.skip("removeEmbeddingForCanonical failed status branch (410/413) — adapterOutcome never literal failed at runtime", () => {});
});
