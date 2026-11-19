// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";
import {
  coordinateErasure,
  getErasureStoreAdapter,
  traverseIndirectDerivatives,
} from "../erasure";
import { responseCache } from "@/lib/response-cache";

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

describe("erasure batch18b — cache indirect, cache purge, embedding purge tallies", () => {
  it("traverseIndirectDerivatives synthesizes cache:indirect neighbor link", () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("cache-indirect-b18b", "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    const indirect = traverseIndirectDerivatives(database, identity);
    const cache = indirect.find((d) => d.storeId === "cache");
    expect(cache?.provenance).toBe("implicit_neighbor_link");
    expect(cache?.sourceHash).toBe(identity.canonicalHash);
  });

  it("cache adapter purges space_cache_state rows and invalidates response cache tags", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("cache-purge-b18b", "message", "ingress", "cache", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "cache", sourceHash: identity.canonicalHash, provenance: "test" }];
    const now = new Date().toISOString();
    database.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES ('default-tenant', 'Default')`).run();
    database.prepare(`INSERT INTO spaces (id, name) VALUES ('space-cache-b18b', 'Cache Space')`).run();
    database
      .prepare(
        `INSERT INTO space_cache_state (space_id, resource_id, last_fetched, cached_size, retrieval_count, invalidated_at)
         VALUES ('space-cache-b18b', ?, ?, 0, 3, NULL)`,
      )
      .run(identity.id, now);
    const invalidateSpy = vi.spyOn(responseCache, "invalidateTag").mockReturnValue(1);
    const adapter = getErasureStoreAdapter("cache");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-${crypto.randomUUID()}`,
      now: new Date(now),
    });
    expect(outcome.status).toBe("purged");
    expect(outcome.reason).toBe("cache_entries_invalidated");
    expect(invalidateSpy).toHaveBeenCalled();
  });

  it("vector adapter reports embedding removal outcome when provenance exists", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("vector-purge-b18b", "message", "ingress", "vector", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "vector", sourceHash: identity.canonicalHash, provenance: "test" }];
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO memory_embedding_provenance
          (id, tenant_id, canonical_id, store_id, adapter_kind, source_hash, model_id, model_version,
           dimensionality, provenance, removability, created_at, updated_at)
         VALUES ('prov-vector-b18b', 'default-tenant', ?, 'vector', 'local', ?, 'model-a', NULL, 8, 'test', 'erasable', ?, ?)`,
      )
      .run(identity.id, identity.canonicalHash, now, now);
    const adapter = getErasureStoreAdapter("vector");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-${crypto.randomUUID()}`,
      now: new Date(now),
    });
    expect(["purged", "zero_match"]).toContain(outcome.status);
    expect(outcome.reason).toMatch(/embedding_removed|no_embedding_removed/);
  });

  it("coordinateErasure records tombstoned embedding outcomes for deferred removability", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("embed-unavail-b18b", "message", "ingress", "vector", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "vector", sourceHash: identity.canonicalHash, provenance: "test" }];
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO memory_embedding_provenance
          (id, tenant_id, canonical_id, store_id, adapter_kind, source_hash, model_id, model_version,
           dimensionality, provenance, removability, lifecycle_state, created_at, updated_at)
         VALUES ('prov-unavail-b18b', 'default-tenant', ?, 'vector', 'local', ?, 'model-a', NULL, 8, 'test', 'deferred', 'active', ?, ?)`,
      )
      .run(identity.id, identity.canonicalHash, now, now);
    const report = await coordinateErasure(database, identity, {
      actorId: "operator",
      scope: { tenantId: "default-tenant", purpose: "operator" },
      now: new Date(now),
    });
    const vectorOutcome = report.storeOutcomes.find((o) => o.storeId === "vector");
    expect(vectorOutcome?.status).toBe("tombstoned");
    expect(vectorOutcome?.reason).toMatch(/deferred/);
  });
});
