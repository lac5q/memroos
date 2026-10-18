// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";
import { coordinateErasure, traverseIndirectDerivatives } from "@/lib/memory/erasure";
import { ensureMessageMemorySchema } from "@/lib/message-memory/store";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  ensureMessageMemorySchema(db);
  return db;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("erasure batch11 — traverseIndirectDerivatives edge walks", () => {
  it("ignores prior report JSON that parses to a non-array object", () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("non-array snapshot", "vault", "ingress", "vault");
    database
      .prepare(
        `INSERT INTO memory_erasure_reports
         (id, tenant_id, canonical_id, status, store_outcomes_json, actor_id, scope_hash, started_at, completed_at)
         VALUES (?, 'default-tenant', ?, 'completed', ?, 'tester', 'sh', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
      )
      .run("er-object", identity.id, JSON.stringify({ storeId: "platform" }));
    const indirect = traverseIndirectDerivatives(database, identity);
    expect(indirect.some((d) => d.storeId === "platform" && d.provenance === "erasure_report_snapshot")).toBe(
      false
    );
    expect(indirect.some((d) => d.storeId === "cache")).toBe(true);
  });

  it("dedupes duplicate snapshot storeIds from prior erasure reports", () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("dup snapshot", "vault", "ingress", "vault");
    const payload = JSON.stringify([
      { storeId: "fts", status: "purged", sourceHash: identity.canonicalHash },
      { storeId: "fts", status: "tombstoned", sourceHash: identity.canonicalHash },
    ]);
    database
      .prepare(
        `INSERT INTO memory_erasure_reports
         (id, tenant_id, canonical_id, status, store_outcomes_json, actor_id, scope_hash, started_at, completed_at)
         VALUES (?, 'default-tenant', ?, 'completed', ?, 'tester', 'sh', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
      )
      .run("er-dup", identity.id, payload);
    const ftsSnapshots = traverseIndirectDerivatives(database, identity).filter(
      (d) => d.storeId === "fts" && d.provenance === "erasure_report_snapshot"
    );
    expect(ftsSnapshots).toHaveLength(1);
  });

  it("dedupes vault neighbors that share the same content_hash", () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("vault dedupe", "vault", "ingress", "vault");
    database
      .prepare(
        `INSERT INTO raw_artifacts
         (id, tenant_id, source_type, artifact_uri, artifact_path, content_hash, source_id)
         VALUES (?, 'default-tenant', 'memory.test', 'vault://a', 'a.bin', ?, ?)`
      )
      .run("art-a", identity.canonicalHash, identity.id);
    database
      .prepare(
        `INSERT INTO raw_artifacts
         (id, tenant_id, source_type, artifact_uri, artifact_path, content_hash, source_id)
         VALUES (?, 'default-tenant', 'memory.test', 'vault://b', 'b.bin', ?, ?)`
      )
      .run("art-b", identity.canonicalHash, identity.id);
    const vaultRows = traverseIndirectDerivatives(database, identity).filter((d) => d.storeId === "vault");
    expect(vaultRows).toHaveLength(1);
  });
});

describe("erasure batch11 — adapter branches", () => {
  it("purges FTS rows when only fts is linked (no message deferral)", async () => {
    const database = freshDb();
    const messageId = Number(
      database
        .prepare(
          `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
           VALUES (?, ?, ?, ?, ?, ?, 'internal', 'indexable')`
        )
        .run("sess-fts-only", "proj", "agent", "user", "fts only purge body", "2026-01-01T00:00:00Z")
        .lastInsertRowid
    );
    const identity = buildCanonicalIdentity("fts only purge body", "message", "ingress", "fts", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [
      { storeId: "fts", sourceHash: identity.canonicalHash, provenance: "test", metadata: { message_id: messageId } },
    ];
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    const fts = report.storeOutcomes.find((o) => o.storeId === "fts");
    expect(fts?.status).toBe("purged");
    expect(fts?.reason).toBe("messages_fts_rows_deleted");
  });

  it("resolves numeric canonical ids as message rowids", async () => {
    const database = freshDb();
    const messageId = Number(
      database
        .prepare(
          `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
           VALUES (?, ?, ?, ?, ?, ?, 'internal', 'indexable')`
        )
        .run("sess-numeric-id", "proj", "agent", "user", "numeric id body", "2026-01-01T00:00:00Z")
        .lastInsertRowid
    );
    const identity = buildCanonicalIdentity("numeric id body", "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    (identity as { id: string }).id = String(messageId);
    identity.derivatives = [
      { storeId: "message", sourceHash: identity.canonicalHash, provenance: "test" },
    ];
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    expect(report.storeOutcomes.find((o) => o.storeId === "message")?.status).toBe("tombstoned");
    const row = database.prepare("SELECT content FROM messages WHERE id = ?").get(messageId) as { content: string };
    expect(row.content).toBe("[erased]");
  });

  it("tombstones candidates matched only by content_hash (no metadata ids)", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("candidate hash only", "lesson", "ingress", "candidates", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [
      { storeId: "candidates", sourceHash: identity.canonicalHash, provenance: "test" },
    ];
    database
      .prepare(
        `INSERT INTO agent_session_captures
         (id, tenant_id, source_agent_id, runtime, session_id, capture_hash, captured_at)
         VALUES (?, 'default-tenant', 'agent', 'test', 'sess', 'ch', '2026-01-01T00:00:00Z')`
      )
      .run("cap-hash-only");
    database
      .prepare(
        `INSERT INTO agent_memory_candidates
         (id, tenant_id, capture_id, agent_id, memory_type, content, content_hash, status, metadata_json, created_at)
         VALUES (?, 'default-tenant', 'cap-hash-only', 'agent', 'lesson', 'secret', ?, 'candidate', '{}', '2026-01-01T00:00:00Z')`
      )
      .run("cand-hash-only", identity.canonicalHash);

    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    expect(report.storeOutcomes.find((o) => o.storeId === "candidates")?.status).toBe("tombstoned");
  });

  it("reports platform zero_match when linked but no rows match", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("platform missing rows", "platform", "ingress", "platform", {
      tenantId: "default-tenant",
    });
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    const platform = report.storeOutcomes.find((o) => o.storeId === "platform");
    expect(platform?.status).toBe("zero_match");
    expect(platform?.reason).toBe("no_platform_rows_for_canonical");
  });

  it("reports salience zero_match when linked but rows are already absent", async () => {
    const database = freshDb();
    const messageId = Number(
      database
        .prepare(
          `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
           VALUES (?, ?, ?, ?, ?, ?, 'internal', 'indexable')`
        )
        .run("sess-no-sal", "proj", "agent", "user", "no salience rows", "2026-01-01T00:00:00Z")
        .lastInsertRowid
    );
    const identity = buildCanonicalIdentity("no salience rows", "message", "ingress", "salience", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [
      { storeId: "salience", sourceHash: identity.canonicalHash, provenance: "test", metadata: { message_id: messageId } },
    ];
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    const salience = report.storeOutcomes.find((o) => o.storeId === "salience");
    expect(salience?.status).toBe("zero_match");
    expect(salience?.reason).toBe("no_salience_rows_for_canonical");
  });

  it("reports federation zero_match when derivative table is missing", async () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS federation_action_derivatives");
    const identity = buildCanonicalIdentity("no fed table", "message", "ingress", "federation", {
      tenantId: "default-tenant",
    });
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    expect(report.storeOutcomes.find((o) => o.storeId === "federation")?.reason).toBe(
      "federation_derivative_table_missing"
    );
  });

  it("purges embeddings store when provenance table is absent", async () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS memory_embedding_provenance");
    const identity = buildCanonicalIdentity("embed no table", "message", "ingress", "embeddings", {
      tenantId: "default-tenant",
    });
    identity.derivatives.push({
      storeId: "embeddings",
      sourceHash: identity.canonicalHash,
      provenance: "test",
    });
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    expect(report.storeOutcomes.find((o) => o.storeId === "embeddings")?.reason).toBe(
      "embeddings_purged_no_provenance_table"
    );
  });

  it("treats Neo4j JSON parse failures as zero_match (empty body)", async () => {
    const database = freshDb();
    const prevPassword = process.env.NEO4J_PASSWORD;
    const prevFetch = global.fetch;
    process.env.NEO4J_PASSWORD = "secret";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error("invalid json body");
      },
    }) as typeof fetch;
    try {
      const identity = buildCanonicalIdentity("neo4j bad json", "graph", "ingress", "graph", {
        tenantId: "default-tenant",
      });
      identity.derivatives.push({
        storeId: "graph",
        sourceHash: identity.canonicalHash,
        provenance: "test",
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

  it("aggregates embedding outcomes idempotently per store", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("double embed", "message", "ingress", "vector", {
      tenantId: "default-tenant",
    });
    const now = "2026-01-01T00:00:00Z";
    for (const id of ["emb-a", "emb-b"]) {
      database
        .prepare(
          `INSERT INTO memory_embedding_provenance
           (id, tenant_id, canonical_id, store_id, adapter_kind, source_hash, model_id, model_version,
            dimensionality, provenance, lifecycle_state, removability, metadata_json, created_at, updated_at)
           VALUES (?, 'default-tenant', ?, 'cache', 'cache', ?, ?, '1.0', 0, 'p', 'active', 'erasable', '{}', ?, ?)`
        )
        .run(id, identity.id, identity.canonicalHash, id, now, now);
    }
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    const cacheOutcomes = report.storeOutcomes.filter((o) => o.storeId === "cache");
    expect(cacheOutcomes.length).toBeGreaterThanOrEqual(1);
  });

  it("reports fts unavailable when messages_fts is missing but fts is linked", async () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS messages_fts");
    const identity = buildCanonicalIdentity("fts missing table", "message", "ingress", "fts", {
      tenantId: "default-tenant",
    });
    const report = await coordinateErasure(database, identity, {
      tenantId: "default-tenant",
      actorId: "tester",
      scope: { tenantId: "default-tenant" },
    });
    const fts = report.storeOutcomes.find((o) => o.storeId === "fts");
    expect(fts?.status).toBe("unavailable");
    expect(fts?.reason).toBe("messages_fts_missing");
  });
});
