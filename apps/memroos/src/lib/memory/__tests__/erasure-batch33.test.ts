// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";
import { registerEmbeddingProvenance } from "@/lib/memory/embedding-lifecycle";
import { registerRetentionRecord } from "@/lib/memory/retention-policy";
import { coordinateErasure, getErasureStoreAdapter, traverseIndirectDerivatives } from "../erasure";

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

describe("erasure batch33 — indirect traversal, message ids, graph error, embedding idempotency", () => {
  it("traverseIndirectDerivatives dedupes embedding ledger rows and tolerates null model_version (243, 252, 254)", () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity(`ledger-b33-${randomUUID().slice(0, 8)}`, "message", "ingress", "vector");
    const now = "2026-03-03T00:00:00.000Z";
    const embId = `emb-b33-${randomUUID().slice(0, 8)}`;
    database
      .prepare(
        `INSERT INTO memory_embedding_provenance
         (id, tenant_id, canonical_id, store_id, adapter_kind, source_hash, model_id, model_version,
          dimensionality, provenance, lifecycle_state, removability, metadata_json, created_at, updated_at)
         VALUES (?, 'default-tenant', ?, 'cache', 'cache', ?, 'm-b33', NULL, 0, 'dup-b33', 'active', 'erasable', '{}', ?, ?),
                (?, 'default-tenant', ?, 'cache', 'cache', ?, 'm-b33-dup', NULL, 0, 'dup-b33-2', 'active', 'erasable', '{}', ?, ?)`,
      )
      .run(
        embId,
        identity.id,
        identity.canonicalHash,
        now,
        now,
        `${embId}-b`,
        identity.id,
        identity.canonicalHash,
        now,
        now,
      );

    const indirect = traverseIndirectDerivatives(database, identity);
    const ledgerCacheRows = indirect.filter(
      (d) => d.storeId === "cache" && d.provenance.startsWith("embedding_provenance:"),
    );
    expect(ledgerCacheRows).toHaveLength(1);
    expect(ledgerCacheRows[0]?.metadata?.model_version).toBeNull();
  });

  it("traverseIndirectDerivatives reads prior erasure report snapshot outcomes (293)", () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity(`report-b33-${randomUUID().slice(0, 8)}`, "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    database
      .prepare(
        `INSERT INTO memory_erasure_reports
         (id, tenant_id, canonical_id, status, store_outcomes_json, actor_id, scope_hash, started_at, completed_at)
         VALUES (?, 'default-tenant', ?, 'completed', ?, 'operator-b33', ?, ?, ?)`,
      )
      .run(
        `rep-b33-${randomUUID().slice(0, 8)}`,
        identity.id,
        JSON.stringify([
          { storeId: "snapshot", status: "tombstoned", sourceHash: 42 },
          { storeId: "fts", status: "purged", sourceHash: identity.canonicalHash },
        ]),
        "scope-hash-b33",
        "2026-03-03T00:00:00.000Z",
        "2026-03-03T00:00:01.000Z",
      );

    const indirect = traverseIndirectDerivatives(database, identity);
    expect(indirect.some((d) => d.storeId === "snapshot" && d.provenance === "erasure_report_snapshot")).toBe(true);
    expect(indirect.some((d) => d.storeId === "fts" && d.sourceHash === identity.canonicalHash)).toBe(true);
  });

  it("resolveMessageIds unions retention ledger message rows (451-466)", async () => {
    const database = freshDb();
    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        `sess-b33-${randomUUID()}`,
        "alpha",
        "agent",
        "user",
        "retention-fts-b33",
        "2026-03-03T00:00:00.000Z",
        "internal",
        "indexable",
      )
      .lastInsertRowid as number;

    const canonicalRef = `canon-b33-${randomUUID().slice(0, 8)}`;
    const identity = buildCanonicalIdentity(canonicalRef, "message", "ingress", "fts", {
      tenantId: "default-tenant",
    });
    identity.id = canonicalRef;

    registerRetentionRecord(database, {
      recordType: "message",
      recordId: String(messageId),
      ontologyType: "memory.note",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: {
        tenantId: "default-tenant",
        project: "alpha",
        canonicalId: identity.id,
      },
      contentHash: randomUUID(),
      actorId: "operator-b33",
      createdAt: "2026-03-03T00:00:00.000Z",
      now: new Date("2026-03-03T00:00:00.000Z"),
    });

    database
      .prepare(`INSERT INTO messages_fts(rowid, content, project, timestamp, agent_id) VALUES (?, ?, 'alpha', '2026-03-03T00:00:00.000Z', 'agent')`)
      .run(messageId, "retention indexed b33");

    identity.derivatives = [{ storeId: "fts", sourceHash: identity.canonicalHash, provenance: "batch33" }];

    const adapter = getErasureStoreAdapter("fts");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-fts-b33-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("purged");
    expect(outcome.metadata?.purged).toBeGreaterThanOrEqual(1);
  });

  it("purgeFtsRows continues when message row missing but fts index remains (503)", async () => {
    const database = freshDb();
    const messageId = database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(`sess-b33-${randomUUID()}`, "alpha", "agent", "user", "orphan-b33", "2026-03-03T00:00:00.000Z", "internal", "indexable")
      .lastInsertRowid as number;

    database
      .prepare(`INSERT INTO messages_fts(rowid, content, project, timestamp, agent_id) VALUES (?, ?, 'alpha', '2026-03-03T00:00:00.000Z', 'agent')`)
      .run(messageId, "orphan fts b33");
    database.prepare(`DELETE FROM messages WHERE id = ?`).run(messageId);

    const identity = buildCanonicalIdentity("orphan-b33", "message", "ingress", "fts", { tenantId: "default-tenant" });
    identity.derivatives = [
      {
        storeId: "fts",
        sourceHash: identity.canonicalHash,
        provenance: "batch33",
        metadata: { message_id: messageId },
      },
    ];

    const adapter = getErasureStoreAdapter("fts");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-fts-orphan-b33-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("zero_match");
  });

  it("graph adapter maps fetch failures to neo4j_error (566)", async () => {
    const database = freshDb();
    const prevPassword = process.env.NEO4J_PASSWORD;
    const prevUrl = process.env.NEO4J_URL;
    process.env.NEO4J_PASSWORD = "secret";
    process.env.NEO4J_URL = "http://localhost:7474";
    const prevFetch = global.fetch;
    global.fetch = vi.fn().mockRejectedValue(new Error("neo4j_down_b33")) as typeof fetch;

    try {
      const identity = buildCanonicalIdentity(`graph-b33-${randomUUID().slice(0, 8)}`, "graph", "ingress", "graph", {
        tenantId: "default-tenant",
      });
      identity.derivatives = [{ storeId: "graph", sourceHash: identity.canonicalHash, provenance: "batch33" }];
      const adapter = getErasureStoreAdapter("graph");
      const outcome = await adapter!.erase(database, "default-tenant", identity, {
        erasureId: `er-graph-b33-${randomUUID()}`,
        now: new Date(),
      });
      expect(outcome.status).toBe("unavailable");
      expect(outcome.reason).toBe("neo4j_error:neo4j_down_b33");
    } finally {
      global.fetch = prevFetch;
      if (prevPassword === undefined) delete process.env.NEO4J_PASSWORD;
      else process.env.NEO4J_PASSWORD = prevPassword;
      if (prevUrl === undefined) delete process.env.NEO4J_URL;
      else process.env.NEO4J_URL = prevUrl;
    }
  });

  it("eraseEmbeddingProjections keeps first purged outcome per store (360)", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity(`embed-idem-b33-${randomUUID().slice(0, 8)}`, "message", "ingress", "vector", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [
      { storeId: "vector", sourceHash: identity.canonicalHash, provenance: "batch33" },
      { storeId: "embeddings", sourceHash: identity.canonicalHash, provenance: "batch33" },
    ];

    registerEmbeddingProvenance(database, {
      canonicalId: identity.id,
      storeId: "vector",
      sourceHash: identity.canonicalHash,
      modelId: `m-a-b33-${randomUUID().slice(0, 6)}`,
      provenance: "batch33",
      removability: "deferred",
    });
    registerEmbeddingProvenance(database, {
      canonicalId: identity.id,
      storeId: "vector",
      sourceHash: identity.canonicalHash,
      modelId: `m-b-b33-${randomUUID().slice(0, 6)}`,
      provenance: "batch33",
      removability: "deferred",
    });

    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "operator-b33",
      scope: { tenantId: "default-tenant" },
      idempotencyKey: `idem-b33-${randomUUID()}`,
    });
    const vectorOutcomes = report.storeOutcomes.filter((o) => o.storeId === "vector");
    expect(vectorOutcomes).toHaveLength(1);
    expect(vectorOutcomes[0]?.status).toBe("tombstoned");
  });
});
