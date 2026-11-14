// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  registerEmbeddingProvenance,
  removeEmbeddingForCanonical,
  type EmbeddingLifecycleAdapter,
} from "../embedding-lifecycle";

let db: Database.Database | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

describe("embedding-lifecycle batch37b — adapter zero_match (411)", () => {
  it("removeEmbeddingForCanonical reports zero_match when adapter delete returns false", () => {
    db = new Database(":memory:");
    initSchema(db);
    const canonicalId = `zero-b37b-${randomUUID().slice(0, 8)}`;
    const row = registerEmbeddingProvenance(db, {
      canonicalId,
      storeId: "vector",
      sourceHash: "a".repeat(64),
      modelId: "m-zero-b37b",
      provenance: "batch37b",
    });
    const adapter: EmbeddingLifecycleAdapter = {
      storeId: "vector",
      delete: () => false,
    };
    const result = removeEmbeddingForCanonical(db, {
      tenantId: row.tenantId,
      row,
      erasureId: `er-b37b-${randomUUID()}`,
      adapter,
    });
    expect(result.status).toBe("zero_match");
    expect(result.row.lifecycleState).toBe("tombstoned");
  });
});