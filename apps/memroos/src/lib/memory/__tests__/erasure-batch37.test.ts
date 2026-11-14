// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";
import { getErasureStoreAdapter, traverseIndirectDerivatives } from "../erasure";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.NEO4J_PASSWORD;
  db?.close();
  db = null;
});

describe("erasure batch37 — indirect traversal, fts defer, graph error", () => {
  it("traverseIndirectDerivatives returns [] for falsy source (219)", () => {
    const database = freshDb();
    expect(traverseIndirectDerivatives(database, "" as unknown as string)).toEqual([]);
  });

  it("traverseIndirectDerivatives accepts string id and walks embedding ledger (222-254)", () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity(`emb-ind-b37-${randomUUID().slice(0, 8)}`, "message", "ingress", "vector", {
      tenantId: "default-tenant",
    });
    const embId = `emb-b37-${randomUUID().slice(0, 12)}`;
    database
      .prepare(
        `INSERT INTO memory_embedding_provenance
           (id, tenant_id, canonical_id, store_id, adapter_kind, source_hash, model_id, dimensionality,
            provenance, lifecycle_state, removability, metadata_json, created_at, updated_at)
         VALUES (?, 'default-tenant', ?, 'cache', 'local', ?, 'model-b37', 0, 'batch37', 'active', 'erasable', '{}', datetime('now'), datetime('now'))`,
      )
      .run(embId, identity.id, identity.canonicalHash);
    const indirect = traverseIndirectDerivatives(database, identity.id);
    const cacheHits = indirect.filter((d) => d.storeId === "cache");
    expect(cacheHits.length).toBeGreaterThanOrEqual(1);
    expect(cacheHits[0]?.metadata?.embedding_id).toBe(embId);
    expect(cacheHits[0]?.metadata?.model_version).toBeNull();
    expect(cacheHits[0]?.metadata?.adapter_kind).toBe("local");
  });

  it("traverseIndirectDerivatives honors erasure_report snapshot storeId (288-293)", () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity(`snap-b37-${randomUUID().slice(0, 8)}`, "message", "ingress", "fts", {
      tenantId: "default-tenant",
    });
    const priorHash = "a".repeat(64);
    database
      .prepare(
        `INSERT INTO memory_erasure_reports
           (id, tenant_id, canonical_id, status, store_outcomes_json, actor_id, scope_hash, started_at, completed_at)
         VALUES (?, 'default-tenant', ?, 'completed', ?, 'op-b37', 'scope-b37', datetime('now'), datetime('now'))`,
      )
      .run(
        `rep-b37-${randomUUID().slice(0, 8)}`,
        identity.id,
        JSON.stringify([{ storeId: "vault", status: "tombstoned", sourceHash: priorHash }]),
      );
    const indirect = traverseIndirectDerivatives(database, identity);
    const snap = indirect.find((d) => d.provenance === "erasure_report_snapshot");
    expect(snap?.sourceHash).toBe(priorHash);
    expect(snap?.metadata?.prior_status).toBe("tombstoned");
  });

  it("fts adapter defers when message store is also linked (595-600)", async () => {
    const database = freshDb();
    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(`sess-b37-${randomUUID()}`, "alpha", "agent", "user", "defer b37", "2026-03-07T00:00:00.000Z", "internal", "indexable")
      .lastInsertRowid as number;
    const identity = buildCanonicalIdentity(`defer-b37-${randomUUID().slice(0, 8)}`, "message", "ingress", "fts", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [
      { storeId: "message", sourceHash: identity.canonicalHash, provenance: "batch37" },
      { storeId: "fts", sourceHash: identity.canonicalHash, provenance: "batch37", metadata: { message_id: String(messageId) } },
    ];
    const adapter = getErasureStoreAdapter("fts");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-defer-b37-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("tombstoned");
    expect(outcome.reason).toBe("fts_deferred_to_message_seal_triggers");
  });

  it("candidates adapter reports not_linked when unlinked and tables exist (771-773)", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity(`no-cand-b37-${randomUUID().slice(0, 8)}`, "message", "ingress", "vault", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "vault", sourceHash: identity.canonicalHash, provenance: "batch37" }];
    const adapter = getErasureStoreAdapter("candidates");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-cand-b37-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.reason).toBe("not_linked:candidates");
  });

  it("graph erase surfaces neo4j_error when fetch throws (563-567)", async () => {
    const database = freshDb();
    process.env.NEO4J_PASSWORD = "neo4j-b37";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("batch37-neo4j-down");
      }),
    );
    const identity = buildCanonicalIdentity(`graph-err-b37-${randomUUID().slice(0, 8)}`, "message", "ingress", "graph", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "graph", sourceHash: identity.canonicalHash, provenance: "batch37" }];
    const adapter = getErasureStoreAdapter("graph");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-graph-b37-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("unavailable");
    expect(outcome.reason).toBe("neo4j_error:batch37-neo4j-down");
  });
});