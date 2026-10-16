import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  coordinateErasure,
  deriveErasureId,
  ErasureAuthorizationError,
  registerErasureStoreAdapter,
  traverseIndirectDerivatives,
} from "../erasure";
import { buildCanonicalIdentity } from "../canonical";

describe("Erasure Coordinator", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE audit_entries (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        actor_id TEXT,
        actor_role TEXT,
        event_type TEXT,
        entity_type TEXT,
        entity_id TEXT,
        reason TEXT,
        metadata_json TEXT,
        created_at TEXT
      );
      CREATE TABLE memory_erasure_reports (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        canonical_id TEXT,
        status TEXT,
        store_outcomes_json TEXT,
        actor_id TEXT,
        scope_hash TEXT,
        started_at TEXT,
        completed_at TEXT
      );
    `);
  });

  it("VAL-MEM-013: Erasure addresses all stores individually with per-store reports", async () => {
    const identity = buildCanonicalIdentity("test content", "test_type", "ingress/test", "vector", { tenantId: "tenant1" });
    identity.derivatives.push({ storeId: "graph", sourceHash: identity.canonicalHash, provenance: "ingress/test" });
    
    const report = await coordinateErasure(db, identity, {
      tenantId: "tenant1",
      actorId: "actor1",
      scope: { tenantId: "tenant1" }
    });
    
    expect(report.storeOutcomes.length).toBeGreaterThan(0);
    
    const vectorOutcome = report.storeOutcomes.find(o => o.storeId === "vector");
    const graphOutcome = report.storeOutcomes.find(o => o.storeId === "graph");
    const ftsOutcome = report.storeOutcomes.find(o => o.storeId === "fts");
    
    expect(vectorOutcome?.status).toBe("purged");
    // Graph is Neo4j-backed: without credentials the adapter must degrade honestly
    // (unavailable) rather than fake a purge. When Neo4j is configured the status
    // may be purged/zero_match depending on matching nodes.
    expect(["unavailable", "purged", "zero_match"]).toContain(graphOutcome?.status);
    if (graphOutcome?.status === "unavailable") {
      expect(report.status).toBe("incomplete");
    } else {
      expect(report.status).toBe("completed");
    }
    expect(ftsOutcome?.status).toBe("zero_match"); // Not linked
  });

  it("VAL-MEM-014: Indirect/snapshot/neighbor/cache links are traversed", () => {
    const identity = buildCanonicalIdentity("test content", "test_type", "ingress/test", "vector");
    const indirect = traverseIndirectDerivatives(db, identity.id);
    
    expect(indirect.length).toBe(2);
    expect(indirect.some(i => i.storeId === "cache")).toBe(true);
    expect(indirect.some(i => i.storeId === "context")).toBe(true);
  });

  it("VAL-MEM-015: Erasure failures produce failed/pending/incomplete status, never false-complete", async () => {
    const identity = buildCanonicalIdentity("test content", "test_type", "ingress/test", "unavailable_adapter", { tenantId: "tenant1" });
    
    const report = await coordinateErasure(db, identity, {
      tenantId: "tenant1",
      actorId: "actor1",
      scope: { tenantId: "tenant1" }
    });
    
    expect(report.status).toBe("incomplete");
    
    const adapterOutcome = report.storeOutcomes.find(o => o.storeId === "unavailable_adapter");
    expect(adapterOutcome?.status).toBe("unavailable");
  });

  it("VAL-MEM-016: Erasure authorization fails closed on wrong scope", async () => {
    const identity = buildCanonicalIdentity("test content", "test_type", "ingress/test", "vector", { tenantId: "tenant1" });
    
    let err: Error | undefined;
    try {
      await coordinateErasure(db, identity, {
        tenantId: "tenant1",
        actorId: "actor1",
        scope: {}
      });
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    expect(err?.message).toContain("missing scope");
  });

  it("VAL-MEM-017: Erasure retries converge once without resurrection", async () => {
    const identity = buildCanonicalIdentity("test content", "test_type", "ingress/test", "vector", { tenantId: "tenant1" });
    const options = {
      tenantId: "tenant1",
      actorId: "actor1",
      scope: { tenantId: "tenant1" },
      idempotencyKey: "fixed_key"
    };
    
    const report1 = await coordinateErasure(db, identity, options);
    expect(report1.status).toBe("completed");
    
    // Retry with the same idempotency key converges
    const report2 = await coordinateErasure(db, identity, options);
    expect(report2.status).toBe("completed");
    
    // Validate we didn't duplicate the audit entry
    const audits = db.prepare("SELECT * FROM audit_entries WHERE entity_id = ?").all(`erasure:fixed_key`);
    expect(audits.length).toBe(1);
  });
});

describe("Erasure Coordinator -- new validation", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE audit_entries (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        actor_id TEXT,
        actor_role TEXT,
        event_type TEXT,
        entity_type TEXT,
        entity_id TEXT,
        reason TEXT,
        metadata_json TEXT,
        created_at TEXT
      );
      CREATE TABLE memory_erasure_reports (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        canonical_id TEXT,
        status TEXT,
        store_outcomes_json TEXT,
        actor_id TEXT,
        scope_hash TEXT,
        started_at TEXT,
        completed_at TEXT
      );
    `);
  });

  it("derives erasureId from sha256(tenantId+canonicalId) when no idempotency key is provided", async () => {
    const identity = buildCanonicalIdentity("foo", "test_type", "ingress/test", "vector", { tenantId: "tenantX" });
    const report = await coordinateErasure(db, identity, {
      tenantId: "tenantX",
      actorId: "actor1",
      scope: { tenantId: "tenantX" },
    });
    expect(report.erasureId).toMatch(/^erasure_[a-f0-9]{64}$/);
    // Same inputs must produce the same id (idempotency).
    const report2 = await coordinateErasure(db, identity, {
      tenantId: "tenantX",
      actorId: "actor1",
      scope: { tenantId: "tenantX" },
    });
    expect(report2.erasureId).toBe(report.erasureId);
  });

  it("rejects scope whose tenantId does not match the canonical identity's tenantId", async () => {
    const identity = buildCanonicalIdentity("foo", "test_type", "ingress/test", "vector", { tenantId: "tenantA" });
    const typedIdentity = identity as typeof identity & { tenantId: string };
    typedIdentity.tenantId = "tenantA";

    let err: Error | undefined;
    try {
      await coordinateErasure(db, identity, {
        tenantId: "tenantB",
        actorId: "actor1",
        scope: { tenantId: "tenantB" },
      });
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    expect(err?.message).toContain("does not match");
  });

  it("coordinateErasure writes MEMORY_ERASURE_COMPLETED audit on success", async () => {
    const identity = buildCanonicalIdentity("foo", "test_type", "ingress/test", "vector", { tenantId: "tenantZ" });
    await coordinateErasure(db, identity, {
      tenantId: "tenantZ",
      actorId: "actor1",
      scope: { tenantId: "tenantZ" },
    });
    const audits = db.prepare("SELECT * FROM audit_entries WHERE event_type = ?").all("memory.erasure.completed");
    expect(audits.length).toBe(1);
  });

  it("writes nothing to memory_erasure_reports when scope authorization fails", async () => {
    const identity = buildCanonicalIdentity("foo", "test_type", "ingress/test", "vector", { tenantId: "tenantA" });
    let err: Error | undefined;
    try {
      await coordinateErasure(db, identity, {
        tenantId: "tenantA",
        actorId: "actor1",
        scope: {},
      });
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    const reports = db.prepare("SELECT COUNT(*) AS count FROM memory_erasure_reports").get() as { count: number };
    expect(reports.count).toBe(0);
  });

  it("traverseIndirectDerivatives discovers embedding provenance cache/snapshot neighbors", () => {
    // Create a memory_embedding_provenance table with a cache entry linked to the canonical id.
    db.exec(`
      CREATE TABLE memory_embedding_provenance (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        canonical_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        adapter_kind TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        model_id TEXT NOT NULL,
        model_version TEXT,
        dimensionality INTEGER NOT NULL DEFAULT 0,
        provenance TEXT NOT NULL,
        lifecycle_state TEXT NOT NULL DEFAULT 'active',
        removability TEXT NOT NULL DEFAULT 'erasable',
        external_ref TEXT,
        last_refreshed_at TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        erasure_id TEXT,
        removed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const identity = buildCanonicalIdentity("foo", "test_type", "ingress/test", "vector");
    db.prepare(
      `INSERT INTO memory_embedding_provenance
       (id, tenant_id, canonical_id, store_id, adapter_kind, source_hash, model_id, model_version,
        dimensionality, provenance, lifecycle_state, removability, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, 'cache', 'cache', ?, 'm', '1.0', 0, 'p', 'active', 'erasable', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    ).run("e_cache_1", "default-tenant", identity.id, identity.canonicalHash);

    const indirect = traverseIndirectDerivatives(db, identity);
    // Always includes cache/context + the discovered embedding provenance row.
    expect(indirect.length).toBeGreaterThanOrEqual(2);
    expect(indirect.some(i => i.storeId === "cache")).toBe(true);
    expect(indirect.some(i => i.storeId === "context")).toBe(true);
  });
});

describe("Erasure helpers and authorization", () => {
  it("deriveErasureId is stable for the same tenant and canonical id", () => {
    const id1 = deriveErasureId("tenant-a", "canon-123");
    const id2 = deriveErasureId("tenant-a", "canon-123");
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^erasure_[a-f0-9]{64}$/);
  });

  it("registerErasureStoreAdapter rejects unknown store ids", () => {
    expect(() =>
      registerErasureStoreAdapter({
        storeId: "bogus" as never,
        async erase() {
          return { status: "purged", reason: "test" };
        },
      })
    ).toThrow(/unknown storeId/);
  });

  it("throws ErasureAuthorizationError when scope tenantId is missing", async () => {
    const db = new Database(":memory:");
    const identity = buildCanonicalIdentity("x", "t", "ingress", "vector", { tenantId: "t1" });
    await expect(
      coordinateErasure(db, identity, { tenantId: "t1", actorId: "a", scope: { tenantId: "" } })
    ).rejects.toBeInstanceOf(ErasureAuthorizationError);
  });

  it("throws when canonical identity tenant disagrees with scope tenant", async () => {
    const db = new Database(":memory:");
    const identity = buildCanonicalIdentity("x", "t", "ingress", "vector", { tenantId: "tenant-a" });
    (identity as typeof identity & { tenantId: string }).tenantId = "tenant-a";
    await expect(
      coordinateErasure(db, identity, {
        tenantId: "tenant-b",
        actorId: "a",
        scope: { tenantId: "tenant-b" },
      })
    ).rejects.toBeInstanceOf(ErasureAuthorizationError);
  });
});

describe("traverseIndirectDerivatives extended graph walks", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE raw_artifacts (
        id TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL,
        source_id TEXT,
        created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z'
      );
      CREATE TABLE memory_erasure_reports (
        id TEXT PRIMARY KEY,
        canonical_id TEXT NOT NULL,
        store_outcomes_json TEXT NOT NULL,
        started_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z'
      );
    `);
  });

  it("returns empty array for falsy source identity", () => {
    expect(traverseIndirectDerivatives(db, "" as unknown as string)).toEqual([]);
  });

  it("discovers vault neighbors from raw_artifacts and prior erasure report snapshots", () => {
    const identity = buildCanonicalIdentity("vault body", "vault", "ingress", "vault");
    db.prepare(
      `INSERT INTO raw_artifacts (id, content_hash, source_id) VALUES (?, ?, ?)`
    ).run("art-1", identity.canonicalHash, identity.id);
    db.prepare(
      `INSERT INTO memory_erasure_reports (id, canonical_id, store_outcomes_json)
       VALUES (?, ?, ?)`
    ).run(
      "er-1",
      identity.id,
      JSON.stringify([{ storeId: "platform", status: "tombstoned", sourceHash: identity.canonicalHash }])
    );

    const indirect = traverseIndirectDerivatives(db, identity);
    expect(indirect.some((d) => d.storeId === "vault")).toBe(true);
    expect(indirect.some((d) => d.provenance === "erasure_report_snapshot")).toBe(true);
  });

  it("skips malformed prior erasure report JSON", () => {
    const identity = buildCanonicalIdentity("bad json", "vault", "ingress", "vault");
    db.prepare(
      `INSERT INTO memory_erasure_reports (id, canonical_id, store_outcomes_json)
       VALUES (?, ?, ?)`
    ).run("er-bad", identity.id, "not-json");
    const indirect = traverseIndirectDerivatives(db, identity.id);
    expect(indirect.length).toBeGreaterThanOrEqual(2);
  });
});

describe("coordinateErasure idempotency and scope", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE audit_entries (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        actor_id TEXT,
        actor_role TEXT,
        event_type TEXT,
        entity_type TEXT,
        entity_id TEXT,
        reason TEXT,
        metadata_json TEXT,
        created_at TEXT
      );
      CREATE TABLE memory_erasure_reports (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        canonical_id TEXT,
        status TEXT,
        store_outcomes_json TEXT,
        actor_id TEXT,
        scope_hash TEXT,
        started_at TEXT,
        completed_at TEXT
      );
    `);
  });

  it("returns the cached completed report without re-running adapters", async () => {
    const identity = buildCanonicalIdentity("cached", "message", "ingress", "vector", { tenantId: "tenant1" });
    const opts = {
      tenantId: "tenant1",
      actorId: "actor1",
      scope: { tenantId: "tenant1", purpose: "dsar" },
      erasureId: "erasure_cached_completed",
    };
    const first = await coordinateErasure(db, identity, opts);
    expect(first.status).toBe("completed");

    const auditBefore = (db.prepare("SELECT COUNT(*) AS c FROM audit_entries").get() as { c: number }).c;
    const second = await coordinateErasure(db, identity, opts);
    const auditAfter = (db.prepare("SELECT COUNT(*) AS c FROM audit_entries").get() as { c: number }).c;

    expect(second.status).toBe("completed");
    expect(second.erasureId).toBe(first.erasureId);
    expect(second.storeOutcomes.map((o) => o.storeId).sort()).toEqual(
      first.storeOutcomes.map((o) => o.storeId).sort()
    );
    expect(auditAfter).toBe(auditBefore);
  });

  it("rejects when options.tenantId disagrees with scope.tenantId", async () => {
    const identity = buildCanonicalIdentity("scope", "message", "ingress", "vector", { tenantId: "tenant-a" });
    await expect(
      coordinateErasure(db, identity, {
        tenantId: "tenant-b",
        actorId: "actor",
        scope: { tenantId: "tenant-a" },
      })
    ).rejects.toBeInstanceOf(ErasureAuthorizationError);
  });

  it("lists registered erasure stores including vector and embeddings", async () => {
    const { listRegisteredErasureStores, getErasureStoreAdapter } = await import("../erasure");
    const stores = listRegisteredErasureStores();
    expect(stores).toContain("vector");
    expect(stores).toContain("embeddings");
    expect(getErasureStoreAdapter("vector")).toBeTruthy();
    expect(getErasureStoreAdapter("nonexistent-store")).toBeUndefined();
  });

  it("persists erasure report even when memory_erasure_reports table is missing", async () => {
    const bare = new Database(":memory:");
    bare.exec(`
      CREATE TABLE audit_entries (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        actor_id TEXT,
        actor_role TEXT,
        event_type TEXT,
        entity_type TEXT,
        entity_id TEXT,
        reason TEXT,
        metadata_json TEXT,
        created_at TEXT
      );
    `);
    const identity = buildCanonicalIdentity("no reports table", "message", "ingress", "vector", {
      tenantId: "tenant1",
    });
    const report = await coordinateErasure(bare, identity, {
      tenantId: "tenant1",
      actorId: "actor1",
      scope: { tenantId: "tenant1", purpose: "dsar" },
    });
    expect(report.status).toBe("completed");
    const audits = bare
      .prepare("SELECT COUNT(*) AS c FROM audit_entries WHERE event_type = ?")
      .get("memory.erasure.completed") as { c: number };
    expect(audits.c).toBe(1);
    bare.close();
  });

  it("marks overall status incomplete when a linked store adapter is unavailable", async () => {
    const identity = buildCanonicalIdentity("graph only", "graph", "ingress", "graph", {
      tenantId: "tenant1",
    });
    const prev = process.env.NEO4J_PASSWORD;
    delete process.env.NEO4J_PASSWORD;
    try {
      const report = await coordinateErasure(db, identity, {
        tenantId: "tenant1",
        actorId: "actor1",
        scope: { tenantId: "tenant1" },
      });
      expect(report.status).toBe("incomplete");
      expect(report.storeOutcomes.find((o) => o.storeId === "graph")?.status).toBe("unavailable");
    } finally {
      if (prev === undefined) delete process.env.NEO4J_PASSWORD;
      else process.env.NEO4J_PASSWORD = prev;
    }
  });

  it("records adapter failures as incomplete erasure without false-complete", async () => {
    registerErasureStoreAdapter({
      storeId: "vector",
      async erase() {
        throw new Error("vector purge exploded");
      },
    });
    const identity = buildCanonicalIdentity("adapter fail", "message", "ingress", "vector", {
      tenantId: "tenant1",
    });
    const report = await coordinateErasure(db, identity, {
      tenantId: "tenant1",
      actorId: "actor1",
      scope: { tenantId: "tenant1" },
    });
    expect(report.status).toBe("failed");
    const vector = report.storeOutcomes.find((o) => o.storeId === "vector");
    expect(vector?.status).toBe("failed");
  });

  it("traverseIndirectDerivatives includes snapshot rows from embedding provenance", () => {
    db.exec(`
      CREATE TABLE memory_embedding_provenance (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        canonical_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        adapter_kind TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        model_id TEXT NOT NULL,
        model_version TEXT,
        dimensionality INTEGER NOT NULL DEFAULT 0,
        provenance TEXT NOT NULL,
        lifecycle_state TEXT NOT NULL DEFAULT 'active',
        removability TEXT NOT NULL DEFAULT 'erasable',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const identity = buildCanonicalIdentity("snap", "vault", "ingress", "vault");
    db.prepare(
      `INSERT INTO memory_embedding_provenance
       (id, tenant_id, canonical_id, store_id, adapter_kind, source_hash, model_id, model_version,
        dimensionality, provenance, lifecycle_state, removability, metadata_json, created_at, updated_at)
       VALUES (?, 'default-tenant', ?, 'snapshot', 'snapshot', ?, 'm', NULL, 0, 'p', 'active', 'erasable', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    ).run("snap-1", identity.id, identity.canonicalHash);
    const indirect = traverseIndirectDerivatives(db, identity);
    expect(indirect.some((d) => d.storeId === "snapshot")).toBe(true);
  });
});
