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

describe("embedding-lifecycle batch35 — synthesized reread and adapter outcomes", () => {
  it("registerEmbeddingProvenance falls back to synthesized row when reread is null (200)", () => {
    const database = freshDb();
    vi.spyOn(embeddingLifecycle, "getEmbeddingProvenance").mockReturnValueOnce(null);
    const canonicalId = `synth-b35-${randomUUID().slice(0, 8)}`;
    const row = registerEmbeddingProvenance(database, {
      canonicalId,
      storeId: "vector",
      sourceHash: "e".repeat(64),
      modelId: "m-synth-b35",
      provenance: "batch35",
      externalRef: "ext-b35",
    });
    expect(row.canonicalId).toBe(canonicalId);
    expect(row.externalRef).toBe("ext-b35");
    expect(row.lifecycleState).toBe("active");
  });

  it("removeEmbeddingForCanonical purges without adapter when removability is erasable", () => {
    const database = freshDb();
    const row = registerEmbeddingProvenance(database, {
      canonicalId: `no-adapter-b35-${randomUUID().slice(0, 8)}`,
      storeId: "vector",
      sourceHash: "f".repeat(64),
      modelId: "m-no-adapter-b35",
      provenance: "batch35",
    });
    const result = removeEmbeddingForCanonical(database, {
      tenantId: row.tenantId,
      row,
      erasureId: `er-${randomUUID()}`,
    });
    expect(result.status).toBe("purged");
    expect(result.row.lifecycleState).toBe("removed");
  });

  it.skip("removeEmbeddingForCanonical failed status branch (410/413) — adapterOutcome union never assigns literal failed at runtime", () => {
    // Sticky: only early-return guards set status failed before outcomeStr narrowing.
  });
});
