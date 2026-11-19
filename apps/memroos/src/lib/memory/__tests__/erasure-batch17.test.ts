// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";
import { coordinateErasure, getErasureStoreAdapter, traverseIndirectDerivatives } from "../erasure";

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

describe("erasure batch17 — traversal skip, embeddings, platform fts", () => {
  it("traverseIndirectDerivatives skips implicit cache link when provenance already added cache", () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("msg-cache-skip", "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    database
      .prepare(
        `INSERT INTO memory_embedding_provenance
         (id, tenant_id, canonical_id, store_id, adapter_kind, source_hash, model_id, dimensionality,
          provenance, lifecycle_state, removability, metadata_json, created_at, updated_at)
         VALUES (?, 'default-tenant', ?, 'cache', 'local', ?, 'm1', 8, 'test', 'active', 'erasable', '{}', ?, ?)`,
      )
      .run(
        `emb_${crypto.randomUUID().slice(0, 16)}`,
        identity.id,
        identity.canonicalHash,
        "2026-07-01T00:00:00.000Z",
        "2026-07-01T00:00:00.000Z",
      );
    const indirect = traverseIndirectDerivatives(database, identity);
    const cacheKeys = indirect.filter((d) => d.storeId === "cache").map((d) => d.provenance);
    expect(cacheKeys.some((p) => p.startsWith("embedding_provenance:"))).toBe(true);
    expect(indirect.some((d) => d.storeId === "context" && d.provenance === "implicit_neighbor_link")).toBe(true);
  });

  it("embeddings adapter purges synthesized provenance when only derivative link exists", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("msg-emb", "message", "ingress", "embeddings", {
      tenantId: "default-tenant",
    });
    const adapter = getErasureStoreAdapter("embeddings");
    expect(adapter).toBeTruthy();
    const result = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `erasure_${crypto.randomUUID()}`,
      now: new Date("2026-07-01T00:00:00.000Z"),
    });
    expect(result.status).toBe("purged");
  });

  it("qmd adapter tombstones linked qmd derivatives", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("doc-qmd", "document", "ingress", "qmd", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "qmd", sourceHash: identity.canonicalHash, provenance: "test" }];
    const report = await coordinateErasure(database, identity, {
      actorId: "operator",
      scope: { tenantId: "default-tenant", purpose: "operator" },
      now: new Date("2026-07-01T01:00:00.000Z"),
    });
    const qmd = report.storeOutcomes.find((o) => o.storeId === "qmd");
    expect(qmd?.status).toBe("tombstoned");
  });
});
