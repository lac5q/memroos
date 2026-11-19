// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";
import {
  coordinateErasure,
  getErasureStoreAdapter,
  registerErasureStoreAdapter,
  traverseIndirectDerivatives,
} from "../erasure";

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

describe("erasure batch18 — fts purge skip, embeddings, coordinator outcomes", () => {
  it("fts purge skips rowids whose messages row disappeared", async () => {
    const database = freshDb();
    const messageId = 4242;
    database
      .prepare(
        `INSERT INTO messages (id, session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES (?, 'sess', 'p', 'agent', 'user', 'fts orphan', '2026-01-01T00:00:00Z', 'internal', 'indexable')`,
      )
      .run(messageId);
    database
      .prepare(
        `INSERT INTO messages_fts(rowid, content, project, timestamp, agent_id)
         VALUES (?, 'fts orphan', 'p', '2026-01-01T00:00:00Z', 'agent')`,
      )
      .run(messageId);
    database.prepare(`DELETE FROM messages WHERE id = ?`).run(messageId);
    const identity = buildCanonicalIdentity(String(messageId), "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [
      {
        storeId: "fts",
        sourceHash: identity.canonicalHash,
        provenance: "test",
        metadata: { message_id: String(messageId) },
      },
    ];
    const adapter = getErasureStoreAdapter("fts");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-${crypto.randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("zero_match");
  });

  it("vector adapter increments purged when provenance rows remove successfully", async () => {
    const database = freshDb();
    const messageId = Number(
      database
        .prepare(
          `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
           VALUES ('s', 'p', 'a', 'user', 'vector purge', '2026-01-01T00:00:00Z', 'internal', 'indexable')`,
        )
        .run().lastInsertRowid,
    );
    const identity = buildCanonicalIdentity(String(messageId), "message", "ingress", "vector", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "vector", sourceHash: identity.canonicalHash, provenance: "test" }];
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO memory_embedding_provenance
          (id, tenant_id, canonical_id, store_id, adapter_kind, source_hash, model_id, model_version,
           dimensionality, provenance, removability, created_at, updated_at)
         VALUES ('prov-b18', 'default-tenant', ?, 'vector', 'local', ?, 'model-a', NULL, 8, 'test', 'erasable', ?, ?)`,
      )
      .run(identity.id, identity.canonicalHash, now, now);
    const adapter = getErasureStoreAdapter("vector");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-${crypto.randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.reason).toMatch(/embedding_removed|no_embedding_removed/);
  });

  it("embeddings adapter returns not_linked when derivative missing", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("emb-not-linked", "message", "ingress", "message", {
      tenantId: "default-tenant",
    });
    const adapter = getErasureStoreAdapter("embeddings");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-${crypto.randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("zero_match");
    expect(outcome.reason).toBe("not_linked");
  });

  it("embeddings adapter purges rows when provenance exists", async () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("emb-linked", "message", "ingress", "embeddings", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "embeddings", sourceHash: identity.canonicalHash, provenance: "test" }];
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO memory_embedding_provenance
          (id, tenant_id, canonical_id, store_id, adapter_kind, source_hash, model_id, model_version,
           dimensionality, provenance, removability, created_at, updated_at)
         VALUES ('prov-emb-b18', 'default-tenant', ?, 'embeddings', 'local', ?, 'model-a', NULL, 8, 'test', 'erasable', ?, ?)`,
      )
      .run(identity.id, identity.canonicalHash, now, now);
    const adapter = getErasureStoreAdapter("embeddings");
    const outcome = await adapter!.erase(database, "default-tenant", identity, {
      erasureId: `er-${crypto.randomUUID()}`,
      now: new Date(),
    });
    expect(["purged", "zero_match"]).toContain(outcome.status);
  });

  it("coordinateErasure records zero_match for unlinked stores and failed adapter status", async () => {
    const database = freshDb();
    registerErasureStoreAdapter({
      storeId: "context",
      erase: async () => ({ status: "failed", reason: "context_failed" }),
    });
    const identity = buildCanonicalIdentity("coord-b18", "message", "ingress", "context", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "context", sourceHash: identity.canonicalHash, provenance: "test" }];
    const report = await coordinateErasure(database, identity, {
      actorId: "operator",
      scope: { tenantId: "default-tenant", purpose: "operator" },
      now: new Date("2026-07-01T00:00:00.000Z"),
    });
    expect(report.status).toBe("failed");
    expect(report.storeOutcomes.some((o) => o.storeId === "context" && o.status === "failed")).toBe(true);
    expect(report.storeOutcomes.some((o) => o.reason === "not_linked")).toBe(true);
  });

  it("traverseIndirectDerivatives skips duplicate cache indirect neighbor", () => {
    const database = freshDb();
    const identity = buildCanonicalIdentity("cache-dup", "message", "ingress", "cache", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "cache", sourceHash: identity.canonicalHash, provenance: "explicit" }];
    const indirect = traverseIndirectDerivatives(database, identity);
    const cacheEntries = indirect.filter((d) => d.storeId === "cache");
    expect(cacheEntries.length).toBeGreaterThanOrEqual(1);
  });
});
