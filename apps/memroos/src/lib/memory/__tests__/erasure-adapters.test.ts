// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";
import { coordinateErasure, listRegisteredErasureStores } from "@/lib/memory/erasure";
import { ensureMessageMemorySchema } from "@/lib/message-memory/store";
import { responseCache } from "@/lib/response-cache";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  ensureMessageMemorySchema(db);
  return db;
}

afterEach(() => {
  responseCache.purge();
  db?.close();
  db = null;
});

describe("MEMLIFE-02 real erasure store adapters", () => {
  it("registers real adapters for previously-placeholder stores", () => {
    const registered = listRegisteredErasureStores();
    for (const storeId of ["graph", "fts", "cache", "context", "candidates", "platform", "message", "salience"]) {
      expect(registered).toContain(storeId);
    }
  });

  it("purges FTS, salience, and redacts messages with per-store receipts", async () => {
    const database = freshDb();
    const messageId = Number(
      database
        .prepare(
          `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
           VALUES (?, ?, ?, ?, ?, ?, 'internal', 'indexable')`
        )
        .run("sess-erase", "proj", "agent", "user", "secret content to erase", "2026-01-01T00:00:00Z")
        .lastInsertRowid
    );
    // FTS row is created by messages_ai trigger (do not manual-insert into external-content FTS).
    expect(
      (database.prepare("SELECT COUNT(*) AS count FROM messages_fts WHERE rowid = ?").get(messageId) as { count: number })
        .count
    ).toBe(1);
    database
      .prepare(`INSERT INTO memory_salience(message_id, tier, salience_score, last_decay_at) VALUES (?, 'mid', 1.0, ?)`)
      .run(messageId, "2026-01-01T00:00:00Z");

    const identity = buildCanonicalIdentity("secret content to erase", "message", "ingress/test", "message", {
      tenantId: "default-tenant",
    });
    // Run FTS before message so we can assert an explicit purge receipt; message
    // sealing also removes indexable FTS rows via triggers afterward.
    identity.derivatives = [
      { storeId: "fts", sourceHash: identity.canonicalHash, provenance: "test", metadata: { message_id: messageId } },
      { storeId: "salience", sourceHash: identity.canonicalHash, provenance: "test", metadata: { message_id: messageId } },
      { storeId: "message", sourceHash: identity.canonicalHash, provenance: "test", metadata: { message_id: messageId } },
    ];

    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });

    expect(["purged", "tombstoned", "zero_match"]).toContain(
      report.storeOutcomes.find((o) => o.storeId === "fts")?.status
    );
    expect(report.storeOutcomes.find((o) => o.storeId === "salience")?.status).toBe("purged");
    expect(report.storeOutcomes.find((o) => o.storeId === "message")?.status).toBe("tombstoned");

    const msg = database.prepare("SELECT content, policy FROM messages WHERE id = ?").get(messageId) as {
      content: string;
      policy: string;
    };
    expect(msg.content).toBe("[erased]");
    expect(msg.policy).toBe("sealed");
    expect(
      (database.prepare("SELECT COUNT(*) AS count FROM memory_salience WHERE message_id = ?").get(messageId) as { count: number })
        .count
    ).toBe(0);
    // External-content FTS: verify via MATCH, not rowid COUNT against the content table.
    expect(
      database.prepare("SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?").all("secret")
    ).toHaveLength(0);

    const reports = database.prepare("SELECT status, store_outcomes_json FROM memory_erasure_reports WHERE id = ?").get(
      report.erasureId
    ) as { status: string; store_outcomes_json: string };
    expect(reports).toBeTruthy();
    expect(JSON.parse(reports.store_outcomes_json).length).toBeGreaterThan(0);
  });

  it("tombstones platform + candidates and invalidates cache tags", async () => {
    const database = freshDb();
    await responseCache.getOrSet("ns", "k1", 60_000, () => ({ ok: true }), ["canon-tag"]);

    database
      .prepare(
        `INSERT INTO platform_message_memory
         (id, dedupe_key, provider, workspace_id, channel_id, thread_id, provider_message_id,
          author_id, author_name, content, content_hash, message_timestamp, permalink, message_row_id,
          metadata, created_at, updated_at)
         VALUES (?, ?, 'slack', 'w', 'c', NULL, 'pm1', 'a', 'A', 'platform secret', ?, '2026-01-01T00:00:00Z',
                 NULL, NULL, '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
      )
      .run("pmm-1", "dedupe-1", "hash-platform-1");

    database
      .prepare(
        `INSERT INTO agent_session_captures
         (id, tenant_id, source_agent_id, runtime, session_id, capture_hash, captured_at)
         VALUES (?, 'default-tenant', 'agent', 'test', 'sess', 'ch', '2026-01-01T00:00:00Z')`
      )
      .run("cap-1");

    database
      .prepare(
        `INSERT INTO agent_memory_candidates
         (id, tenant_id, capture_id, agent_id, memory_type, content, content_hash, status, metadata_json, created_at)
         VALUES (?, 'default-tenant', 'cap-1', 'agent', 'lesson', 'candidate secret', 'hash-platform-1', 'candidate', '{}', '2026-01-01T00:00:00Z')`
      )
      .run("cand-1");

    const identity = buildCanonicalIdentity("platform secret", "platform", "ingress", "platform", {
      tenantId: "default-tenant",
    });
    // Force match via content_hash equality by rewriting identity hash for platform lookup.
    (identity as { canonicalHash: string }).canonicalHash = "hash-platform-1";
    identity.derivatives.push(
      { storeId: "candidates", sourceHash: "hash-platform-1", provenance: "test", metadata: { candidate_id: "cand-1" } },
      { storeId: "cache", sourceHash: "hash-platform-1", provenance: "test" }
    );

    // Tag cache with canonical id for invalidation.
    await responseCache.getOrSet("ns", "k2", 60_000, () => ({ v: 2 }), [identity.id, `canonical:${identity.id}`]);

    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });

    expect(report.storeOutcomes.find((o) => o.storeId === "platform")?.status).toBe("tombstoned");
    expect(report.storeOutcomes.find((o) => o.storeId === "candidates")?.status).toBe("tombstoned");
    expect(report.storeOutcomes.find((o) => o.storeId === "cache")?.status).toBe("purged");

    const platform = database.prepare("SELECT content FROM platform_message_memory WHERE id = ?").get("pmm-1") as {
      content: string;
    };
    expect(platform.content).toBe("[erased]");
    const candidate = database.prepare("SELECT content, status FROM agent_memory_candidates WHERE id = ?").get("cand-1") as {
      content: string;
      status: string;
    };
    expect(candidate.content).toBe("[erased]");
    expect(candidate.status).toBe("rejected");
  });

  it("tombstones vault, qmd, embeddings, context, and federation stores", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("multi-store", "message", "ingress", "vault", {
      tenantId: "default-tenant",
    });
    identity.derivatives.push(
      { storeId: "qmd", sourceHash: identity.canonicalHash, provenance: "test" },
      { storeId: "embeddings", sourceHash: identity.canonicalHash, provenance: "test" },
      { storeId: "context", sourceHash: identity.canonicalHash, provenance: "test" },
      { storeId: "federation", sourceHash: identity.canonicalHash, provenance: "test" }
    );

    database
      .prepare(
        `INSERT INTO raw_artifacts
         (id, tenant_id, source_type, artifact_uri, artifact_path, content_hash, source_id)
         VALUES (?, 'default-tenant', 'memory.test', 'vault://x', 'x.bin', ?, ?)`
      )
      .run("vault-art-1", identity.canonicalHash, identity.id);

    database
      .prepare(
        `INSERT INTO agent_handoff_packs
         (id, tenant_id, title, status, context_pack_json, source_capture_ids_json)
         VALUES (?, 'default-tenant', 'pack', 'ready', ?, '[]')`
      )
      .run("pack-1", JSON.stringify({ canonical_id: identity.id, body: "secret" }));

    database
      .prepare(
        `INSERT INTO federation_action_artifacts
         (id, tenant_id, space_id, federation_run_id, pack_hash, pack_bytes, pack_item_count,
          bound_status, scope_hash, policy_hash, ontology_hash, artifact_hash)
         VALUES (?, 'default-tenant', 'space-1', 'run-1', 'ph', 1, 1, 'bounded', 'sh', 'ph2', 'oh', 'ah')`
      )
      .run("fed-art-1");
    database
      .prepare(
        `INSERT INTO federation_action_derivatives
         (id, tenant_id, artifact_id, canonical_id, canonical_hash, source_id, status)
         VALUES (?, 'default-tenant', ?, ?, ?, ?, 'active')`
      )
      .run("fed-deriv-1", "fed-art-1", identity.id, identity.canonicalHash, identity.id);

    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
      idempotencyKey: "multi-store-erasure",
    });

    expect(report.storeOutcomes.find((o) => o.storeId === "vault")?.status).toBe("tombstoned");
    expect(report.storeOutcomes.find((o) => o.storeId === "qmd")?.status).toBe("tombstoned");
    expect(report.storeOutcomes.find((o) => o.storeId === "embeddings")?.status).toBe("purged");
    expect(report.storeOutcomes.find((o) => o.storeId === "context")?.status).toBe("tombstoned");
    expect(report.storeOutcomes.find((o) => o.storeId === "federation")?.status).toBe("tombstoned");

    const pack = database
      .prepare("SELECT status, redaction_state FROM agent_handoff_packs WHERE id = ?")
      .get("pack-1") as { status: string; redaction_state: string };
    expect(pack.status).toBe("expired");
    expect(pack.redaction_state).toBe("redacted");
  });

  it("returns cached completed report on retry without duplicating work", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("idempotent", "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    const opts = {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
      idempotencyKey: "completed-cache-key",
    };
    const first = await coordinateErasure(database, identity, opts);
    const second = await coordinateErasure(database, identity, opts);
    expect(second.status).toBe("completed");
    expect(second.erasureId).toBe(first.erasureId);
    expect(second.storeOutcomes.map((o) => o.storeId).sort()).toEqual(
      first.storeOutcomes.map((o) => o.storeId).sort()
    );
  });

  it("reports graph unavailable when Neo4j is not configured (honest degrade)", async () => {
    const database = freshDb();
    const prev = process.env.NEO4J_PASSWORD;
    delete process.env.NEO4J_PASSWORD;
    try {
      const identity = buildCanonicalIdentity("g", "graph", "ingress", "graph", { tenantId: "default-tenant" });
      const report = await coordinateErasure(database, identity, {
        tenantId: "default-tenant",
        actorId: "tester",
        scope: { tenantId: "default-tenant" },
      });
      const graph = report.storeOutcomes.find((o) => o.storeId === "graph");
      expect(graph?.status).toBe("unavailable");
      expect(graph?.reason).toMatch(/neo4j_not_configured/);
      expect(report.status).toBe("incomplete");
    } finally {
      if (prev === undefined) delete process.env.NEO4J_PASSWORD;
      else process.env.NEO4J_PASSWORD = prev;
    }
  });

  it("purges Neo4j nodes when the graph backend responds with deleted count", async () => {
    const database = freshDb();
    const prevPassword = process.env.NEO4J_PASSWORD;
    const prevFetch = global.fetch;
    process.env.NEO4J_PASSWORD = "secret";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ data: [{ row: [2] }] }] }),
    }) as typeof fetch;
    try {
      const identity = buildCanonicalIdentity("graph-node", "graph", "ingress", "graph", {
        tenantId: "default-tenant",
      });
      const report = await coordinateErasure(database, identity, {
        tenantId: "default-tenant",
        actorId: "tester",
        scope: { tenantId: "default-tenant" },
      });
      const graph = report.storeOutcomes.find((o) => o.storeId === "graph");
      expect(graph?.status).toBe("purged");
      expect(graph?.metadata).toMatchObject({ deleted: 2 });
    } finally {
      if (prevPassword === undefined) delete process.env.NEO4J_PASSWORD;
      else process.env.NEO4J_PASSWORD = prevPassword;
      global.fetch = prevFetch;
    }
  });

  it("defers FTS when message sealing is also targeted", async () => {
    const database = freshDb();
    const messageId = Number(
      database
        .prepare(
          `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
           VALUES (?, ?, ?, ?, ?, ?, 'internal', 'indexable')`
        )
        .run("sess-defer", "proj", "agent", "user", "defer fts content", "2026-01-01T00:00:00Z")
        .lastInsertRowid
    );
    const identity = buildCanonicalIdentity("defer fts content", "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [
      { storeId: "fts", sourceHash: identity.canonicalHash, provenance: "test", metadata: { message_id: messageId } },
      { storeId: "message", sourceHash: identity.canonicalHash, provenance: "test", metadata: { message_id: messageId } },
    ];
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    const fts = report.storeOutcomes.find((o) => o.storeId === "fts");
    expect(fts?.status).toBe("tombstoned");
    expect(fts?.reason).toBe("fts_deferred_to_message_seal_triggers");
  });

  it("invalidates cache tags and purges salience via retention-linked messages", async () => {
    const database = freshDb();
    const messageId = Number(
      database
        .prepare(
          `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
           VALUES (?, ?, ?, ?, ?, ?, 'internal', 'indexable')`
        )
        .run("sess-ret", "proj", "agent", "user", "retention linked", "2026-01-01T00:00:00Z")
        .lastInsertRowid
    );
    database
      .prepare(
        `INSERT INTO memory_retention_records
         (id, tenant_id, record_type, record_id, ontology_type, purpose, scope_json, created_at, updated_at)
         VALUES (?, 'default-tenant', 'message', ?, 'message', 'test', ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
      )
      .run(`ret-${messageId}`, String(messageId), JSON.stringify({ canonicalId: "canon-ret-1" }));

    const identity = buildCanonicalIdentity("retention linked", "message", "ingress", "cache", {
      tenantId: "default-tenant",
    });
    (identity as { id: string }).id = "canon-ret-1";
    identity.derivatives.push(
      { storeId: "salience", sourceHash: identity.canonicalHash, provenance: "test", metadata: { message_id: messageId } },
      { storeId: "cache", sourceHash: identity.canonicalHash, provenance: "test" }
    );

    await responseCache.getOrSet("ns", "cache-key", 60_000, () => ({ ok: true }), [identity.id]);

    database
      .prepare(`INSERT INTO memory_salience(message_id, tier, salience_score, last_decay_at) VALUES (?, 'mid', 1.0, ?)`)
      .run(messageId, "2026-01-01T00:00:00Z");

    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    expect(report.storeOutcomes.find((o) => o.storeId === "cache")?.status).toBe("purged");
    expect(report.storeOutcomes.find((o) => o.storeId === "salience")?.status).toBe("purged");
  });

  it("tombstones ontology_candidates alongside agent_memory_candidates", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("candidate body", "lesson", "ingress", "candidates", {
      tenantId: "default-tenant",
    });
    identity.derivatives.push({
      storeId: "candidates",
      sourceHash: identity.canonicalHash,
      provenance: "test",
      metadata: { candidate_id: "cand-onto-1" },
    });
    database
      .prepare(
        `INSERT INTO agent_session_captures
         (id, tenant_id, source_agent_id, runtime, session_id, capture_hash, captured_at)
         VALUES (?, 'default-tenant', 'agent', 'test', 'sess', 'ch', '2026-01-01T00:00:00Z')`
      )
      .run("cap-onto");
    database
      .prepare(
        `INSERT INTO agent_memory_candidates
         (id, tenant_id, capture_id, agent_id, memory_type, content, content_hash, status, metadata_json, created_at)
         VALUES (?, 'default-tenant', 'cap-onto', 'agent', 'lesson', 'secret', ?, 'candidate', '{}', '2026-01-01T00:00:00Z')`
      )
      .run("cand-onto-1", identity.canonicalHash);
    database
      .prepare(
        `INSERT INTO ontology_candidates
         (id, tenant_id, space_id, source_id, source_hash, extractor_id, extractor_version,
          candidate_kind, namespace, proposed_json, confidence_label, confidence_score,
          evidence_hash, original_json, status, created_at)
         VALUES (?, 'default-tenant', 'space-1', ?, ?, 'extractor', '1.0.0',
                 'type', 'default', '{}', 'high', 0.9,
                 'evidence-hash', '{}', 'pending', '2026-01-01T00:00:00Z')`
      )
      .run("onto-1", identity.id, identity.canonicalHash);

    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    expect(report.storeOutcomes.find((o) => o.storeId === "candidates")?.status).toBe("tombstoned");
    const onto = database
      .prepare(`SELECT status FROM ontology_candidates WHERE id = ?`)
      .get("onto-1") as { status: string };
    expect(onto.status).toBe("invalidated");
  });

  it("purges embedding provenance rows and aggregates per-store outcomes", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("embed body", "message", "ingress", "vector", {
      tenantId: "default-tenant",
    });
    identity.derivatives.push({
      storeId: "embeddings",
      sourceHash: identity.canonicalHash,
      provenance: "test",
    });
    const now = "2026-01-01T00:00:00Z";
    database
      .prepare(
        `INSERT INTO memory_embedding_provenance
         (id, tenant_id, canonical_id, store_id, adapter_kind, source_hash, model_id, model_version,
          dimensionality, provenance, lifecycle_state, removability, metadata_json, created_at, updated_at)
         VALUES (?, 'default-tenant', ?, 'vector', 'local', ?, 'm1', '1.0', 8, 'p', 'active', 'erasable', '{}', ?, ?)`
      )
      .run("emb-vec-1", identity.id, identity.canonicalHash, now, now);
    database
      .prepare(
        `INSERT INTO memory_embedding_provenance
         (id, tenant_id, canonical_id, store_id, adapter_kind, source_hash, model_id, model_version,
          dimensionality, provenance, lifecycle_state, removability, metadata_json, created_at, updated_at)
         VALUES (?, 'default-tenant', ?, 'cache', 'cache', ?, 'm2', '1.0', 0, 'p', 'active', 'erasable', '{}', ?, ?)`
      )
      .run("emb-cache-1", identity.id, identity.canonicalHash, now, now);

    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    const vector = report.storeOutcomes.find((o) => o.storeId === "vector");
    const embeddings = report.storeOutcomes.find((o) => o.storeId === "embeddings");
    expect(["purged", "tombstoned", "zero_match"]).toContain(vector?.status);
    expect(["purged", "tombstoned", "zero_match"]).toContain(embeddings?.status);
  });

  it("reports neo4j zero_match when the graph backend deletes zero nodes", async () => {
    const database = freshDb();
    const prevPassword = process.env.NEO4J_PASSWORD;
    const prevFetch = global.fetch;
    process.env.NEO4J_PASSWORD = "secret";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ data: [{ row: [0] }] }] }),
    }) as typeof fetch;
    try {
      const identity = buildCanonicalIdentity("empty graph", "graph", "ingress", "graph", {
        tenantId: "default-tenant",
      });
      const report = await coordinateErasure(database, identity, {
        tenantId: "default-tenant",
        actorId: "tester",
        scope: { tenantId: "default-tenant" },
      });
      const graph = report.storeOutcomes.find((o) => o.storeId === "graph");
      expect(graph?.status).toBe("zero_match");
      expect(graph?.reason).toMatch(/no_neo4j_nodes/);
    } finally {
      if (prevPassword === undefined) delete process.env.NEO4J_PASSWORD;
      else process.env.NEO4J_PASSWORD = prevPassword;
      global.fetch = prevFetch;
    }
  });

  it("returns graph zero_match when the identity is not linked to graph", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("no graph link", "message", "ingress", "vector", {
      tenantId: "default-tenant",
    });
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    const graph = report.storeOutcomes.find((o) => o.storeId === "graph");
    expect(graph?.status).toBe("zero_match");
    expect(graph?.reason).toMatch(/not_linked/);
  });

  it("vector adapter purges when provenance table is absent but vector is linked", async () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS memory_embedding_provenance");
    const identity = buildCanonicalIdentity("no prov table", "message", "ingress", "vector", {
      tenantId: "default-tenant",
    });
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    expect(report.storeOutcomes.find((o) => o.storeId === "vector")?.status).toBe("purged");
  });

  it("federation store reports zero_match when no active derivatives exist", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("no fed", "message", "ingress", "federation", {
      tenantId: "default-tenant",
    });
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    expect(report.storeOutcomes.find((o) => o.storeId === "federation")?.status).toBe("zero_match");
  });

  it("message erasure reports zero_match when resolved message ids are absent", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("ghost message", "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [
      {
        storeId: "message",
        sourceHash: identity.canonicalHash,
        provenance: "test",
        metadata: { message_id: 999_999 },
      },
    ];
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    const message = report.storeOutcomes.find((o) => o.storeId === "message");
    expect(message?.status).toBe("zero_match");
    expect(message?.reason).toMatch(/no_messages|already_absent/);
  });

  it("traverseIndirectDerivatives dedupes repeated embedding provenance rows", async () => {
    const database = freshDb();
    const { traverseIndirectDerivatives } = await import("../erasure");
    const identity = buildCanonicalIdentity("dedupe", "message", "ingress", "vector");
    const now = "2026-01-01T00:00:00Z";
    for (const [id, modelId] of [
      ["emb-dup-1", "m1"],
      ["emb-dup-2", "m2"],
    ] as const) {
      database
        .prepare(
          `INSERT INTO memory_embedding_provenance
           (id, tenant_id, canonical_id, store_id, adapter_kind, source_hash, model_id, model_version,
            dimensionality, provenance, lifecycle_state, removability, metadata_json, created_at, updated_at)
           VALUES (?, 'default-tenant', ?, 'cache', 'cache', ?, ?, '1.0', 0, 'p', 'active', 'erasable', '{}', ?, ?)`
        )
        .run(id, identity.id, identity.canonicalHash, modelId, now, now);
    }
    const indirect = traverseIndirectDerivatives(database, identity);
    const embeddingCache = indirect.filter(
      (d) => d.storeId === "cache" && d.provenance.startsWith("embedding_provenance:")
    );
    expect(embeddingCache).toHaveLength(1);
  });

  it("returns cached completed report when stored outcomes JSON is malformed", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("bad-json-cache", "message", "ingress", "vector", {
      tenantId: "default-tenant",
    });
    const erasureId = "erasure_bad_json_cache";
    database
      .prepare(
        `INSERT INTO memory_erasure_reports
         (id, tenant_id, canonical_id, status, store_outcomes_json, actor_id, scope_hash, started_at, completed_at)
         VALUES (?, 'default-tenant', ?, 'completed', 'not-json', 'tester', 'sh', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
      )
      .run(erasureId, identity.id);
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
      erasureId,
    });
    expect(report.status).toBe("completed");
    expect(report.storeOutcomes).toEqual([]);
  });

  it("reports graph unavailable when Neo4j HTTP body includes errors despite ok status", async () => {
    const database = freshDb();
    const prevPassword = process.env.NEO4J_PASSWORD;
    const prevFetch = global.fetch;
    process.env.NEO4J_PASSWORD = "secret";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ errors: [{ code: "Neo.ClientError.Statement.SyntaxError" }] }),
    }) as typeof fetch;
    try {
      const identity = buildCanonicalIdentity("neo4j-errors", "graph", "ingress", "graph", {
        tenantId: "default-tenant",
      });
      const report = await coordinateErasure(database, identity, {
        tenantId: "default-tenant",
        actorId: "tester",
        scope: { tenantId: "default-tenant" },
      });
      const graph = report.storeOutcomes.find((o) => o.storeId === "graph");
      expect(graph?.status).toBe("unavailable");
      expect(graph?.reason).toMatch(/neo4j_graph_backend_unavailable/);
    } finally {
      if (prevPassword === undefined) delete process.env.NEO4J_PASSWORD;
      else process.env.NEO4J_PASSWORD = prevPassword;
      global.fetch = prevFetch;
    }
  });

  it("invalidates space_cache_state rows when cache store is targeted", async () => {
    const database = freshDb();
    database.prepare(`INSERT INTO spaces(id, tenant_id, name) VALUES ('space-cache', 'default-tenant', 'cache-space')`).run();
    const identity = buildCanonicalIdentity("cache target", "message", "ingress", "cache", {
      tenantId: "default-tenant",
    });
    database
      .prepare(
        `INSERT INTO space_cache_state(space_id, resource_id, last_fetched, cached_size, retrieval_count)
         VALUES ('space-cache', ?, '2026-01-01T00:00:00Z', 128, 3)`
      )
      .run(identity.id);
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    const cache = report.storeOutcomes.find((o) => o.storeId === "cache");
    expect(cache?.status).toBe("purged");
    const row = database
      .prepare(`SELECT invalidated_at, retrieval_count FROM space_cache_state WHERE resource_id = ?`)
      .get(identity.id) as { invalidated_at: string | null; retrieval_count: number };
    expect(row.invalidated_at).toBeTruthy();
    expect(row.retrieval_count).toBe(0);
  });

  it("context adapter reports unavailable when agent_handoff_packs is missing but context is linked", async () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS agent_handoff_packs");
    const identity = buildCanonicalIdentity("ctx missing table", "message", "ingress", "context", {
      tenantId: "default-tenant",
    });
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    const context = report.storeOutcomes.find((o) => o.storeId === "context");
    expect(context?.status).toBe("unavailable");
    expect(context?.reason).toMatch(/agent_handoff_packs_missing/);
  });

  it("reports neo4j unavailable when the HTTP backend errors", async () => {
    const database = freshDb();
    const prevPassword = process.env.NEO4J_PASSWORD;
    const prevFetch = global.fetch;
    process.env.NEO4J_PASSWORD = "secret";
    global.fetch = vi.fn().mockRejectedValue(new Error("connection reset")) as typeof fetch;
    try {
      const identity = buildCanonicalIdentity("neo4j-down", "graph", "ingress", "graph", {
        tenantId: "default-tenant",
      });
      const report = await coordinateErasure(database, identity, {
        tenantId: "default-tenant",
        actorId: "tester",
        scope: { tenantId: "default-tenant" },
      });
      const graph = report.storeOutcomes.find((o) => o.storeId === "graph");
      expect(graph?.status).toBe("unavailable");
      expect(graph?.reason).toMatch(/neo4j_error/);
    } finally {
      if (prevPassword === undefined) delete process.env.NEO4J_PASSWORD;
      else process.env.NEO4J_PASSWORD = prevPassword;
      global.fetch = prevFetch;
    }
  });

  it("reports platform and salience zero_match when not linked", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("unlinked stores", "message", "ingress", "vector", {
      tenantId: "default-tenant",
    });
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    expect(report.storeOutcomes.find((o) => o.storeId === "platform")?.reason).toMatch(/not_linked/);
    expect(report.storeOutcomes.find((o) => o.storeId === "salience")?.reason).toMatch(/not_linked/);
    expect(report.storeOutcomes.find((o) => o.storeId === "qmd")?.reason).toMatch(/not_linked/);
  });

  it("vault adapter reports zero_match when no artifacts exist", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("no vault", "message", "ingress", "vault", {
      tenantId: "default-tenant",
    });
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    expect(report.storeOutcomes.find((o) => o.storeId === "vault")?.status).toBe("zero_match");
  });

  it("candidates adapter reports unavailable when candidate tables are missing", async () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS agent_memory_candidates");
    database.exec("DROP TABLE IF EXISTS ontology_candidates");
    const identity = buildCanonicalIdentity("no tables", "lesson", "ingress", "candidates", {
      tenantId: "default-tenant",
    });
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    const candidates = report.storeOutcomes.find((o) => o.storeId === "candidates");
    expect(candidates?.status).toBe("unavailable");
    expect(candidates?.reason).toMatch(/candidate_tables_missing/);
  });

  it("reports message store unavailable when messages table is missing but message is linked", async () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS messages");
    const identity = buildCanonicalIdentity("ghost table", "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [
      {
        storeId: "message",
        sourceHash: identity.canonicalHash,
        provenance: "test",
        metadata: { message_id: 1 },
      },
    ];
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    const message = report.storeOutcomes.find((o) => o.storeId === "message");
    expect(message?.status).toBe("unavailable");
    expect(message?.reason).toMatch(/messages_table_missing/);
  });

  it("maps skipped_retained embedding removals to tombstoned store outcomes", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("retained embed", "message", "ingress", "vector", {
      tenantId: "default-tenant",
    });
    const now = "2026-01-01T00:00:00Z";
    database
      .prepare(
        `INSERT INTO memory_embedding_provenance
         (id, tenant_id, canonical_id, store_id, adapter_kind, source_hash, model_id, model_version,
          dimensionality, provenance, lifecycle_state, removability, metadata_json, created_at, updated_at)
         VALUES (?, 'default-tenant', ?, 'cache', 'cache', ?, 'm1', '1.0', 0, 'p', 'active', 'retained', '{}', ?, ?)`
      )
      .run("emb-retained-1", identity.id, identity.canonicalHash, now, now);
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    const cache = report.storeOutcomes.find((o) => o.storeId === "cache");
    expect(cache?.status).toBe("tombstoned");
    expect(cache?.reason).toMatch(/retained/);
  });

  it("reports neo4j unavailable when HTTP response is not ok", async () => {
    const database = freshDb();
    const prevPassword = process.env.NEO4J_PASSWORD;
    const prevFetch = global.fetch;
    process.env.NEO4J_PASSWORD = "secret";
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    }) as typeof fetch;
    try {
      const identity = buildCanonicalIdentity("neo4j-http-fail", "graph", "ingress", "graph", {
        tenantId: "default-tenant",
      });
      const report = await coordinateErasure(database, identity, {
        tenantId: "default-tenant",
        actorId: "tester",
        scope: { tenantId: "default-tenant" },
      });
      const graph = report.storeOutcomes.find((o) => o.storeId === "graph");
      expect(graph?.status).toBe("unavailable");
      expect(graph?.reason).toMatch(/neo4j_graph_backend_unavailable/);
    } finally {
      if (prevPassword === undefined) delete process.env.NEO4J_PASSWORD;
      else process.env.NEO4J_PASSWORD = prevPassword;
      global.fetch = prevFetch;
    }
  });

  it("redacts platform rows matched via platform_message_memory message_row_id", async () => {
    const database = freshDb();
    const messageId = Number(
      database
        .prepare(
          `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
           VALUES (?, ?, ?, ?, ?, ?, 'internal', 'indexable')`
        )
        .run("sess-pmm-row", "proj", "agent", "user", "platform row match", "2026-01-01T00:00:00Z")
        .lastInsertRowid
    );
    const identity = buildCanonicalIdentity("platform row match", "message", "ingress", "platform", {
      tenantId: "default-tenant",
    });
    database
      .prepare(
        `INSERT INTO platform_message_memory
         (id, dedupe_key, provider, workspace_id, channel_id, thread_id, provider_message_id,
          author_id, author_name, content, content_hash, message_timestamp, permalink, message_row_id,
          metadata, created_at, updated_at)
         VALUES (?, ?, 'slack', 'w', 'c', NULL, 'pm1', 'a', 'A', 'platform row match', ?, '2026-01-01T00:00:00Z',
                 NULL, ?, '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
      )
      .run("pmm-row-1", "dedupe-row-1", identity.canonicalHash, messageId);
    identity.derivatives = [
      {
        storeId: "platform",
        sourceHash: identity.canonicalHash,
        provenance: "test",
        metadata: { message_id: messageId },
      },
    ];
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    expect(report.storeOutcomes.find((o) => o.storeId === "platform")?.status).toBe("tombstoned");
    const row = database
      .prepare("SELECT content FROM platform_message_memory WHERE id = ?")
      .get("pmm-row-1") as { content: string };
    expect(row.content).toBe("[erased]");
  });

  it("marks adapter failures as failed overall status", async () => {
    const database = freshDb();
    const { getErasureStoreAdapter, registerErasureStoreAdapter } = await import("../erasure");
    const original = getErasureStoreAdapter("qmd");
    registerErasureStoreAdapter({
      storeId: "qmd",
      async erase() {
        throw new Error("qmd_adapter_exploded");
      },
    });
    try {
      const identity = buildCanonicalIdentity("qmd fail", "doc", "ingress", "qmd", {
        tenantId: "default-tenant",
      });
      const report = await coordinateErasure(database, identity, {
        tenantId: "default-tenant",
        actorId: "tester",
        scope: { tenantId: "default-tenant" },
      });
      expect(report.status).toBe("failed");
      const qmd = report.storeOutcomes.find((o) => o.storeId === "qmd");
      expect(qmd?.status).toBe("failed");
      expect(qmd?.reason).toContain("qmd_adapter_exploded");
    } finally {
      if (original) registerErasureStoreAdapter(original);
    }
  });
});
