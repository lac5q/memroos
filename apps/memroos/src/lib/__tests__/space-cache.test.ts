// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";
import { setSpaceShared } from "@/lib/shared-space";
import {
  recordCacheFetch,
  getCacheState,
  invalidateResource,
  invalidateSpace,
  getInvalidationHistory,
} from "@/lib/space-cache";

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

function setupCache(): {
  db: Database.Database;
  spaceId: string;
  actorId: string;
} {
  const db = freshDb();
  const space = createSpace(db, { tenantId: "default-tenant", name: "cache-test" });
  return { db, spaceId: space.id, actorId: "user-1" };
}

function countAuditRows(
  db: Database.Database,
  eventType: string,
  entityId?: string,
): number {
  let sql = "SELECT COUNT(*) AS n FROM audit_entries WHERE event_type = ?";
  const params: (string | number)[] = [eventType];
  if (entityId) {
    sql += " AND entity_id = ?";
    params.push(entityId);
  }
  const row = db.prepare(sql).get(...params) as { n: number };
  return row.n;
}

function insertAuditInvalidation(
  db: Database.Database,
  input: {
    spaceId: string;
    resourceId?: string;
    actorId: string;
    createdAt: string;
    reason?: string;
  },
): void {
  const entityId = input.resourceId
    ? `cache:${input.spaceId}:${input.resourceId}`
    : `cache:${input.spaceId}`;
  const metadata = {
    spaceId: input.spaceId,
    resourceId: input.resourceId ?? null,
    actorId: input.actorId,
    reason: input.reason ?? null,
    scope: input.resourceId ? "resource" : "space",
    actionType: "cache.invalidated",
  };
  db.prepare(
    `INSERT INTO audit_entries
       (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
     VALUES (?, 'default-tenant', ?, 'operator', 'cache.invalidated', 'cache', ?, ?, ?, ?)`,
  ).run(
    `caci_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    input.actorId,
    entityId,
    `seed invalidation`,
    JSON.stringify(metadata),
    input.createdAt,
  );
}

describe("space-cache.ts (Phase 140 / CACHEADMIN-01..05)", () => {
  let db: Database.Database;
  let spaceId: string;
  let actorId: string;

  beforeEach(() => {
    ({ db, spaceId, actorId } = setupCache());
  });

  it("1) recordCacheFetch inserts a new cache entry with retrieval_count = 1", () => {
    recordCacheFetch(db, { spaceId, resourceId: "doc-1", cachedSize: 100 });
    const state = getCacheState(db, spaceId);
    expect(state.totalResources).toBe(1);
    expect(state.totalCachedSize).toBe(100);
    expect(state.totalRetrievals).toBe(1);
    expect(state.entries[0].resourceId).toBe("doc-1");
    expect(state.entries[0].cachedSize).toBe(100);
    expect(state.entries[0].retrievalCount).toBe(1);
    expect(state.entries[0].invalidatedAt).toBeNull();
  });

  it("2) recordCacheFetch upserts and increments retrieval_count for existing resource", () => {
    recordCacheFetch(db, { spaceId, resourceId: "doc-1", cachedSize: 100 });
    recordCacheFetch(db, { spaceId, resourceId: "doc-1", cachedSize: 120 });
    recordCacheFetch(db, { spaceId, resourceId: "doc-1", cachedSize: 130 });
    const state = getCacheState(db, spaceId);
    expect(state.totalResources).toBe(1);
    expect(state.totalCachedSize).toBe(130);
    expect(state.totalRetrievals).toBe(3);
    expect(state.entries[0].retrievalCount).toBe(3);
  });

  it("2b) getCacheState returns empty summary when spaceId is blank", () => {
    expect(getCacheState(db, "  ")).toEqual({
      totalResources: 0,
      totalCachedSize: 0,
      totalRetrievals: 0,
      entries: [],
    });
    expect(getInvalidationHistory(db, "")).toEqual([]);
  });

  it("3) getCacheState returns empty summary for unknown space", () => {
    const state = getCacheState(db, "spc_unknown");
    expect(state.totalResources).toBe(0);
    expect(state.totalCachedSize).toBe(0);
    expect(state.totalRetrievals).toBe(0);
    expect(state.entries).toEqual([]);
  });

  it("4) invalidateResource stamps invalidated_at and writes cache.invalidated audit", () => {
    recordCacheFetch(db, { spaceId, resourceId: "doc-1", cachedSize: 100 });
    invalidateResource(db, { spaceId, resourceId: "doc-1", actorId, reason: "stale" });
    const state = getCacheState(db, spaceId);
    expect(state.entries[0].invalidatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(countAuditRows(db, "cache.invalidated", `cache:${spaceId}:doc-1`)).toBe(1);
  });

  it("5) invalidateResource coalesces repeated invalidations within 5 seconds", () => {
    recordCacheFetch(db, { spaceId, resourceId: "doc-1", cachedSize: 100 });
    invalidateResource(db, { spaceId, resourceId: "doc-1", actorId, reason: "stale" });
    invalidateResource(db, { spaceId, resourceId: "doc-1", actorId, reason: "stale" });
    const state = getCacheState(db, spaceId);
    expect(state.entries[0].invalidatedAt).toBeTruthy();
    expect(countAuditRows(db, "cache.invalidated", `cache:${spaceId}:doc-1`)).toBe(1);
    expect(countAuditRows(db, "cache.coalesced")).toBe(1);
  });

  it("6) invalidateResource rate limits after 5 invalidations in 60 seconds", () => {
    recordCacheFetch(db, { spaceId, resourceId: "doc-1", cachedSize: 100 });
    const base = new Date(Date.now() - 30000).toISOString();
    for (let i = 0; i < 5; i++) {
      insertAuditInvalidation(db, {
        spaceId,
        resourceId: "doc-1",
        actorId,
        createdAt: new Date(Date.parse(base) + i * 1000).toISOString(),
      });
    }
    expect(() =>
      invalidateResource(db, { spaceId, resourceId: "doc-1", actorId, reason: "stale" }),
    ).toThrow(/cache invalidation rate limit exceeded for resource \(CACHEADMIN-04\)/);
    expect(countAuditRows(db, "cache.rate_limit")).toBe(1);
  });

  it("7) invalidateSpace stamps invalidated_at on all resources and writes audit", () => {
    recordCacheFetch(db, { spaceId, resourceId: "doc-1", cachedSize: 100 });
    recordCacheFetch(db, { spaceId, resourceId: "doc-2", cachedSize: 200 });
    invalidateSpace(db, { spaceId, actorId, reason: "refresh" });
    const state = getCacheState(db, spaceId);
    expect(state.entries).toHaveLength(2);
    expect(state.entries.every((e) => e.invalidatedAt !== null)).toBe(true);
    expect(countAuditRows(db, "cache.invalidated", `cache:${spaceId}`)).toBe(1);
  });

  it("8) invalidateSpace rate limits after 3 space invalidations in 60 seconds", () => {
    const base = new Date(Date.now() - 30000).toISOString();
    for (let i = 0; i < 3; i++) {
      insertAuditInvalidation(db, {
        spaceId,
        actorId,
        createdAt: new Date(Date.parse(base) + i * 1000).toISOString(),
      });
    }
    expect(() => invalidateSpace(db, { spaceId, actorId, reason: "refresh" })).toThrow(
      /cache invalidation rate limit exceeded for space \(CACHEADMIN-04\)/,
    );
    expect(countAuditRows(db, "cache.rate_limit")).toBe(1);
  });

  it("9) invalidateResource on shared space requires reason='invalidate-from-source'", () => {
    setSpaceShared(db, { spaceId, isShared: true, actorId, reason: "shared" });
    recordCacheFetch(db, { spaceId, resourceId: "doc-1", cachedSize: 100 });
    expect(() =>
      invalidateResource(db, { spaceId, resourceId: "doc-1", actorId, reason: "stale" }),
    ).toThrow(/shared space cache invalidation requires reason='invalidate-from-source' \(CACHEADMIN-03\)/);
    expect(() =>
      invalidateResource(db, {
        spaceId,
        resourceId: "doc-1",
        actorId,
        reason: "invalidate-from-source",
      }),
    ).not.toThrow();
  });

  it("10) invalidateSpace on shared space requires reason='invalidate-from-source'", () => {
    setSpaceShared(db, { spaceId, isShared: true, actorId, reason: "shared" });
    expect(() => invalidateSpace(db, { spaceId, actorId, reason: "refresh" })).toThrow(
      /shared space cache invalidation requires reason='invalidate-from-source' \(CACHEADMIN-03\)/,
    );
    expect(() =>
      invalidateSpace(db, { spaceId, actorId, reason: "invalidate-from-source" }),
    ).not.toThrow();
  });

  it("11) getInvalidationHistory returns resource-level invalidations newest-first", async () => {
    recordCacheFetch(db, { spaceId, resourceId: "doc-1", cachedSize: 100 });
    recordCacheFetch(db, { spaceId, resourceId: "doc-2", cachedSize: 200 });
    invalidateResource(db, { spaceId, resourceId: "doc-1", actorId, reason: "stale" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    invalidateResource(db, { spaceId, resourceId: "doc-2", actorId, reason: "old" });
    const history = getInvalidationHistory(db, spaceId);
    expect(history).toHaveLength(2);
    expect(history[0].resourceId).toBe("doc-2");
    expect(history[0].reason).toBe("old");
    expect(history[1].resourceId).toBe("doc-1");
    expect(history[1].reason).toBe("stale");
  });

  it("12) getInvalidationHistory includes space-level invalidations with resourceId null", () => {
    invalidateSpace(db, { spaceId, actorId, reason: "refresh" });
    const history = getInvalidationHistory(db, spaceId);
    expect(history).toHaveLength(1);
    expect(history[0].resourceId).toBeNull();
    expect(history[0].reason).toBe("refresh");
    expect(history[0].actorId).toBe(actorId);
  });

  it("12b) getInvalidationHistory preserves explicit null metadata fields", () => {
    db.prepare(
      `INSERT INTO audit_entries (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "audit-null-meta",
      "default-tenant",
      actorId,
      "operator",
      "cache.invalidated",
      "space_cache",
      `cache:${spaceId}:all`,
      JSON.stringify({ resourceId: null, reason: null }),
      new Date().toISOString()
    );
    const history = getInvalidationHistory(db, spaceId);
    expect(history[0]).toMatchObject({ resourceId: null, reason: null, actorId });
  });

  it("13) recordCacheFetch and invalidateResource validate inputs", () => {
    expect(() => recordCacheFetch(db, { spaceId: "", resourceId: "doc-1" })).toThrow(
      /recordCacheFetch: spaceId is required/,
    );
    expect(() => recordCacheFetch(db, { spaceId, resourceId: "" })).toThrow(
      /recordCacheFetch: resourceId is required/,
    );
    expect(() =>
      invalidateResource(db, { spaceId: "", resourceId: "doc-1", actorId }),
    ).toThrow(/invalidateResource: spaceId is required/);
    expect(() =>
      invalidateResource(db, { spaceId, resourceId: "", actorId }),
    ).toThrow(/invalidateResource: resourceId is required/);
    expect(() =>
      invalidateResource(db, { spaceId, resourceId: "doc-1", actorId: "" }),
    ).toThrow(/invalidateResource: actorId is required/);
  });

  it("14) invalidateSpace validates inputs and space existence", () => {
    expect(() => invalidateSpace(db, { spaceId: "", actorId })).toThrow(
      /invalidateSpace: spaceId is required/,
    );
    expect(() => invalidateSpace(db, { spaceId, actorId: "" })).toThrow(
      /invalidateSpace: actorId is required/,
    );
    expect(() =>
      invalidateSpace(db, { spaceId: "spc_unknown", actorId }),
    ).toThrow(/space-cache: space 'spc_unknown' not found/);
  });
});
